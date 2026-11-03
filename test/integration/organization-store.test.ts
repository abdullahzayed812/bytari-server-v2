import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  listNotifications,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  type RegisteredUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

const shipping = {
  recipientName: 'أحمد علي',
  recipientPhone: '07701234567',
  city: 'بغداد',
  addressLine: 'الكرادة، شارع 62',
};

type StoreType = 'CLINIC' | 'VETERINARY_OFFICE';

interface Ctx {
  admin: RegisteredUser;
  owner: RegisteredUser;
  customer: RegisteredUser;
  orgId: string;
  productId: string;
}

async function createProduct(
  token: string,
  orgId: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/organizations/${orgId}/office-products`)
    .set(bearer(token))
    .send({ name: 'شامبو طبي', productType: 'CARE', price: '12500', ...body });
}

async function setup(type: StoreType = 'CLINIC'): Promise<Ctx> {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const customer = await registerUser(app);
  const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, { type });
  const product = await createProduct(owner.accessToken, org.id);
  expect(product.status).toBe(201);
  return { admin, owner, customer, orgId: org.id, productId: product.body.data.id as string };
}

async function addToCart(token: string, orgId: string, productId: string, quantity = 1) {
  return request(app)
    .post(`/api/v1/organization-store/organizations/${orgId}/cart/items`)
    .set(bearer(token))
    .send({ productId, quantity });
}

async function checkout(token: string, orgId: string) {
  return request(app)
    .post(`/api/v1/organization-store/organizations/${orgId}/orders`)
    .set(bearer(token))
    .send({ paymentMethod: 'COD', ...shipping });
}

async function placeOrder(ctx: Ctx, quantity = 2): Promise<string> {
  expect(
    (await addToCart(ctx.customer.accessToken, ctx.orgId, ctx.productId, quantity)).status,
  ).toBe(201);
  const res = await checkout(ctx.customer.accessToken, ctx.orgId);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

function setSellerStatus(token: string, orgId: string, orderId: string, status: string) {
  return request(app)
    .patch(`/api/v1/organizations/${orgId}/store-orders/${orderId}/status`)
    .set(bearer(token))
    .send({ status });
}

describe('Clinic Store — products', () => {
  it('a clinic owns a product catalogue shown on its public profile', async () => {
    const ctx = await setup('CLINIC');
    const stranger = await registerUser(app);
    const list = await request(app)
      .get(`/api/v1/organizations/discover/${ctx.orgId}/office-products`)
      .set(bearer(stranger.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([ctx.productId]);

    const row = await getTestDb()('veterinary_office_products')
      .where({ id: ctx.productId })
      .first();
    expect(row.organization_type).toBe('CLINIC');
  });

  it('clinic STAFF can view but not create products; a VETERINARY_STORE is still rejected', async () => {
    const ctx = await setup('CLINIC');
    const staff = await registerUser(app);
    await addOrganizationMember(app, ctx.owner.accessToken, ctx.orgId, {
      userId: staff.id,
      role: 'STAFF',
    });
    const view = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/office-products`)
      .set(bearer(staff.accessToken));
    expect(view.status).toBe(200);
    expect((await createProduct(staff.accessToken, ctx.orgId)).status).toBe(403);

    // A VETERINARY_STORE keeps its own separate catalogue module.
    const storeOwner = await registerApprovedVet(app);
    const store = await createActiveOrganization(
      app,
      storeOwner.accessToken,
      ctx.admin.accessToken,
      {
        type: 'VETERINARY_STORE',
      },
    );
    const res = await createProduct(storeOwner.accessToken, store.id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });
});

describe.each(['CLINIC', 'VETERINARY_OFFICE'] as const)('%s store — cart & checkout', (type) => {
  it('cart → checkout snapshots the lines, empties the cart and starts the tracking history', async () => {
    const ctx = await setup(type);
    const added = await addToCart(ctx.customer.accessToken, ctx.orgId, ctx.productId, 2);
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({
      organizationId: ctx.orgId,
      itemCount: 2,
      subtotalAmount: '25000.00',
      totalAmount: '25000.00',
      currency: 'IQD',
    });

    const carts = await request(app)
      .get('/api/v1/organization-store/carts')
      .set(bearer(ctx.customer.accessToken));
    expect(carts.body.data).toEqual([
      expect.objectContaining({ organizationId: ctx.orgId, organizationType: type, itemCount: 2 }),
    ]);

    const order = await checkout(ctx.customer.accessToken, ctx.orgId);
    expect(order.status).toBe(201);
    expect(order.body.data).toMatchObject({
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      totalAmount: '25000.00',
      currency: 'IQD',
      canCancel: true,
      organization: { id: ctx.orgId, type },
      items: [expect.objectContaining({ name: 'شامبو طبي', unitPrice: '12500.00', quantity: 2 })],
      history: [expect.objectContaining({ fromStatus: null, toStatus: 'PENDING' })],
    });
    expect(order.body.data.orderNumber).toMatch(type === 'CLINIC' ? /^CLS-/ : /^OFS-/);

    const cart = await request(app)
      .get(`/api/v1/organization-store/organizations/${ctx.orgId}/cart`)
      .set(bearer(ctx.customer.accessToken));
    expect(cart.body.data.items).toHaveLength(0);

    // Later price changes never touch the placed order (snapshot).
    await request(app)
      .patch(`/api/v1/organizations/${ctx.orgId}/office-products/${ctx.productId}`)
      .set(bearer(ctx.owner.accessToken))
      .send({ price: '99000' });
    const mine = await request(app)
      .get(`/api/v1/organization-store/orders/${order.body.data.id}`)
      .set(bearer(ctx.customer.accessToken));
    expect(mine.body.data.items[0].unitPrice).toBe('12500.00');
  });

  it('notifies the store owner (STORE_ORDER_PLACED) and the customer (STORE_ORDER_SUBMITTED)', async () => {
    const ctx = await setup(type);
    const orderId = await placeOrder(ctx);
    await tick();
    const ownerN = (await listNotifications(app, ctx.owner.accessToken)).body.data as Array<{
      type: string;
      data: Record<string, string>;
    }>;
    expect(ownerN.find((n) => n.type === 'STORE_ORDER_PLACED')?.data).toMatchObject({
      orderId,
      organizationId: ctx.orgId,
      store: 'ORGANIZATION',
      audience: 'SELLER',
    });
    const customerN = (await listNotifications(app, ctx.customer.accessToken)).body.data as Array<{
      type: string;
      data: Record<string, string>;
    }>;
    expect(customerN.map((n) => n.type)).toEqual(['STORE_ORDER_SUBMITTED']);
    expect(customerN[0]?.data).toMatchObject({ orderId, audience: 'CUSTOMER' });
  });
});

describe('Organization store — purchase rules', () => {
  it('rejects hidden / unpriced products, another store’s product and a second currency', async () => {
    const ctx = await setup('CLINIC');
    const unpriced = await createProduct(ctx.owner.accessToken, ctx.orgId, { price: undefined });
    const noPrice = await addToCart(ctx.customer.accessToken, ctx.orgId, unpriced.body.data.id);
    expect(noPrice.status).toBe(409);
    expect(noPrice.body.error.code).toBe('PRODUCT_NOT_PURCHASABLE');

    const hidden = await createProduct(ctx.owner.accessToken, ctx.orgId);
    await request(app)
      .patch(`/api/v1/organizations/${ctx.orgId}/office-products/${hidden.body.data.id}`)
      .set(bearer(ctx.owner.accessToken))
      .send({ isHidden: true });
    const hiddenRes = await addToCart(ctx.customer.accessToken, ctx.orgId, hidden.body.data.id);
    expect(hiddenRes.status).toBe(409);

    const other = await setup('VETERINARY_OFFICE');
    const cross = await addToCart(ctx.customer.accessToken, ctx.orgId, other.productId);
    expect(cross.status).toBe(404);

    const usd = await createProduct(ctx.owner.accessToken, ctx.orgId, {
      currency: 'USD',
      price: '10',
    });
    expect((await addToCart(ctx.customer.accessToken, ctx.orgId, ctx.productId)).status).toBe(201);
    const mixed = await addToCart(ctx.customer.accessToken, ctx.orgId, usd.body.data.id);
    expect(mixed.status).toBe(409);
    expect(mixed.body.error.code).toBe('STORE_CART_CURRENCY_MISMATCH');
  });

  it('checkout fails when a cart product was deleted meanwhile, and an empty cart cannot check out', async () => {
    const ctx = await setup('CLINIC');
    expect((await checkout(ctx.customer.accessToken, ctx.orgId)).status).toBe(400);
    await addToCart(ctx.customer.accessToken, ctx.orgId, ctx.productId);
    await request(app)
      .delete(`/api/v1/organizations/${ctx.orgId}/office-products/${ctx.productId}`)
      .set(bearer(ctx.owner.accessToken));
    const cart = await request(app)
      .get(`/api/v1/organization-store/organizations/${ctx.orgId}/cart`)
      .set(bearer(ctx.customer.accessToken));
    expect(cart.body.data.items[0].available).toBe(false);
    const res = await checkout(ctx.customer.accessToken, ctx.orgId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_NOT_PURCHASABLE');
  });

  it('an expired store cannot sell or work its orders', async () => {
    const ctx = await setup('CLINIC');
    const orderId = await placeOrder(ctx);
    await getTestDb()('clinic_details')
      .where({ organization_id: ctx.orgId })
      .update({ subscription_start_date: '2020-01-01', subscription_end_date: '2020-02-01' });
    expect((await addToCart(ctx.customer.accessToken, ctx.orgId, ctx.productId)).status).toBe(404);
    const seller = await setSellerStatus(ctx.owner.accessToken, ctx.orgId, orderId, 'CONFIRMED');
    expect(seller.status).toBe(403);
    expect(seller.body.error.code).toBe('ORGANIZATION_SUBSCRIPTION_EXPIRED');
    // The customer still sees their order.
    const mine = await request(app)
      .get(`/api/v1/organization-store/orders/${orderId}`)
      .set(bearer(ctx.customer.accessToken));
    expect(mine.status).toBe(200);
  });
});

describe('Organization store — order status & tracking', () => {
  it('the seller moves the order through the status machine; the customer is notified each step', async () => {
    const ctx = await setup('CLINIC');
    const orderId = await placeOrder(ctx);

    const list = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/store-orders`)
      .set(bearer(ctx.owner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ id: orderId, isNew: true });
    expect(list.body.data[0].customer).toMatchObject({ id: ctx.customer.id });

    const summary = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/store-orders/summary`)
      .set(bearer(ctx.owner.accessToken));
    expect(summary.body.data).toMatchObject({ newCount: 1, pendingCount: 1, totalCount: 1 });

    const opened = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/store-orders/${orderId}`)
      .set(bearer(ctx.owner.accessToken));
    expect(opened.body.data.isNew).toBe(false);

    const bad = await setSellerStatus(ctx.owner.accessToken, ctx.orgId, orderId, 'DELIVERED');
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('ORDER_INVALID_TRANSITION');

    for (const status of ['CONFIRMED', 'SHIPPED', 'DELIVERED']) {
      const res = await setSellerStatus(ctx.owner.accessToken, ctx.orgId, orderId, status);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
    }
    await tick();

    const tracked = await request(app)
      .get(`/api/v1/organization-store/orders/${orderId}`)
      .set(bearer(ctx.customer.accessToken));
    expect(tracked.body.data).toMatchObject({
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      canCancel: false,
    });
    expect(tracked.body.data.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      'PENDING',
      'CONFIRMED',
      'SHIPPED',
      'DELIVERED',
    ]);

    const customerN = (await listNotifications(app, ctx.customer.accessToken)).body.data as Array<{
      type: string;
      data: Record<string, string>;
    }>;
    expect(
      customerN
        .filter((n) => n.type === 'STORE_ORDER_STATUS_CHANGED')
        .map((n) => n.data.status)
        .sort(),
    ).toEqual(['CONFIRMED', 'DELIVERED', 'SHIPPED']);
  });

  it('the customer may cancel only while PENDING; the seller is told', async () => {
    const ctx = await setup('VETERINARY_OFFICE');
    const first = await placeOrder(ctx);
    const cancel = await request(app)
      .post(`/api/v1/organization-store/orders/${first}/cancel`)
      .set(bearer(ctx.customer.accessToken))
      .send({ note: 'غيرت رأيي' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');
    expect(cancel.body.data.history.at(-1)).toMatchObject({
      toStatus: 'CANCELLED',
      actorSide: 'CUSTOMER',
      note: 'غيرت رأيي',
    });
    await tick();
    const ownerN = (await listNotifications(app, ctx.owner.accessToken)).body.data as Array<{
      type: string;
      data: Record<string, string>;
    }>;
    expect(ownerN.find((n) => n.type === 'STORE_ORDER_UPDATED')?.data).toMatchObject({
      orderId: first,
      status: 'CANCELLED',
    });

    const second = await placeOrder(ctx);
    await setSellerStatus(ctx.owner.accessToken, ctx.orgId, second, 'CONFIRMED');
    const late = await request(app)
      .post(`/api/v1/organization-store/orders/${second}/cancel`)
      .set(bearer(ctx.customer.accessToken))
      .send({});
    expect(late.status).toBe(409);

    // A delivered office order counts as a sale on the office dashboard.
    await setSellerStatus(ctx.owner.accessToken, ctx.orgId, second, 'SHIPPED');
    await setSellerStatus(ctx.owner.accessToken, ctx.orgId, second, 'DELIVERED');
    const dash = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/office-dashboard/summary`)
      .set(bearer(ctx.owner.accessToken));
    expect(dash.body.data.salesCount).toBe(1);
  });
});

describe('Organization store — isolation & permissions', () => {
  it('orders are visible only to their customer and to the selling organization', async () => {
    const ctx = await setup('CLINIC');
    const orderId = await placeOrder(ctx);
    const otherCustomer = await registerUser(app);
    const otherStore = await setup('CLINIC');

    expect(
      (
        await request(app)
          .get(`/api/v1/organization-store/orders/${orderId}`)
          .set(bearer(otherCustomer.accessToken))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/v1/organization-store/orders/${orderId}/cancel`)
          .set(bearer(otherCustomer.accessToken))
          .send({})
      ).status,
    ).toBe(404);
    const mine = await request(app)
      .get('/api/v1/organization-store/orders')
      .set(bearer(otherCustomer.accessToken));
    expect(mine.body.data).toHaveLength(0);

    // Another store's owner: their own org route never reaches this order…
    const viaOwnOrg = await request(app)
      .get(`/api/v1/organizations/${otherStore.orgId}/store-orders/${orderId}`)
      .set(bearer(otherStore.owner.accessToken));
    expect(viaOwnOrg.status).toBe(404);
    expect(
      (await setSellerStatus(otherStore.owner.accessToken, otherStore.orgId, orderId, 'CONFIRMED'))
        .status,
    ).toBe(404);
    // …and this store's list is forbidden to them.
    const foreign = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/store-orders`)
      .set(bearer(otherStore.owner.accessToken));
    expect(foreign.status).toBe(403);
  });

  it('a clinic employee becomes a store supervisor with order permissions and keeps their staff access', async () => {
    const ctx = await setup('CLINIC');
    const orderId = await placeOrder(ctx);
    const staff = await registerUser(app); // not a veterinarian
    await addOrganizationMember(app, ctx.owner.accessToken, ctx.orgId, {
      userId: staff.id,
      role: 'STAFF',
    });

    // Plain STAFF: no access to incoming orders.
    const before = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/store-orders`)
      .set(bearer(staff.accessToken));
    expect(before.status).toBe(403);

    // A non-vet cannot receive clinical / management rights.
    const tooMuch = await request(app)
      .post(`/api/v1/organizations/${ctx.orgId}/supervisors`)
      .set(bearer(ctx.owner.accessToken))
      .send({ userId: staff.id, permissions: ['store.order.read', 'member.add'] });
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.error.code).toBe('VETERINARIAN_APPROVAL_REQUIRED');

    // A non-member non-vet cannot be made a store supervisor either.
    const outsider = await registerUser(app);
    const outsiderRes = await request(app)
      .post(`/api/v1/organizations/${ctx.orgId}/supervisors`)
      .set(bearer(ctx.owner.accessToken))
      .send({ userId: outsider.id, permissions: ['store.order.read'] });
    expect(outsiderRes.status).toBe(403);

    const assigned = await request(app)
      .post(`/api/v1/organizations/${ctx.orgId}/supervisors`)
      .set(bearer(ctx.owner.accessToken))
      .send({
        userId: staff.id,
        permissions: ['store.order.read', 'store.order.manage', 'product.update'],
        retainRolePermissions: true,
      });
    expect(assigned.status).toBe(201);
    expect(assigned.body.data.permissions).toEqual(
      expect.arrayContaining(['store.order.manage', 'product.update', 'medical_record.read']),
    );

    const list = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/store-orders`)
      .set(bearer(staff.accessToken));
    expect(list.status).toBe(200);
    const confirm = await setSellerStatus(staff.accessToken, ctx.orgId, orderId, 'CONFIRMED');
    expect(confirm.status).toBe(200);
    // Staff access kept (medical records stay readable).
    const pets = await request(app)
      .get(`/api/v1/organizations/${ctx.orgId}/clinic-dashboard/summary`)
      .set(bearer(staff.accessToken));
    expect(pets.body.data.permissions).toMatchObject({
      canViewMedicalRecords: true,
      canViewStoreOrders: true,
      canManageStoreOrders: true,
      canManageProducts: true,
    });

    // Widening the non-vet supervisor to management keys is refused.
    const widen = await request(app)
      .patch(`/api/v1/organizations/${ctx.orgId}/supervisors/${assigned.body.data.id}`)
      .set(bearer(ctx.owner.accessToken))
      .send({ permissions: ['store.order.read', 'supervisor.assign'] });
    expect(widen.status).toBe(403);

    await tick();
    // The owner hears that the supervisor confirmed the order; the supervisor does not.
    const ownerN = (await listNotifications(app, ctx.owner.accessToken)).body.data as Array<{
      type: string;
    }>;
    expect(ownerN.some((n) => n.type === 'STORE_ORDER_UPDATED')).toBe(true);
    const staffN = (await listNotifications(app, staff.accessToken)).body.data as Array<{
      type: string;
    }>;
    expect(staffN.some((n) => n.type === 'STORE_ORDER_UPDATED')).toBe(false);
  });

  it('a supervisor with read-only order access cannot change status; new orders reach them', async () => {
    const ctx = await setup('VETERINARY_OFFICE');
    const vet = await registerApprovedVet(app);
    await request(app)
      .post(`/api/v1/organizations/${ctx.orgId}/supervisors`)
      .set(bearer(ctx.owner.accessToken))
      .send({ userId: vet.id, permissions: ['store.order.read'] });
    const orderId = await placeOrder(ctx);
    await tick();
    const vetN = (await listNotifications(app, vet.accessToken)).body.data as Array<{
      type: string;
    }>;
    expect(vetN.some((n) => n.type === 'STORE_ORDER_PLACED')).toBe(true);
    expect((await setSellerStatus(vet.accessToken, ctx.orgId, orderId, 'CONFIRMED')).status).toBe(
      403,
    );
  });

  it('an organization holding store orders is never permanently purged', async () => {
    const ctx = await setup('CLINIC');
    await placeOrder(ctx);
    const soft = await request(app)
      .delete(`/api/v1/admin/organizations/${ctx.orgId}`)
      .set(bearer(ctx.admin.accessToken))
      .send({ reason: 'test' });
    expect(soft.status).toBe(200);
    const purge = await request(app)
      .delete(`/api/v1/admin/organizations/${ctx.orgId}/permanent`)
      .set(bearer(ctx.admin.accessToken));
    expect(purge.status).toBe(409);
    expect(purge.body.error.code).toBe('ORGANIZATION_PURGE_BLOCKED');
    expect(purge.body.error.message).toContain('organization_store_orders');
  });
});
