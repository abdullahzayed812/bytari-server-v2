import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  type RegisteredUser,
} from '../helpers/factories.js';

/**
 * 2026-11-04: clinic specialty ("تخصص العيادة"), the Admin clinic store
 * switch, and the seller's "receive new orders" switch (clinic + office).
 */
const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const shipping = {
  paymentMethod: 'COD',
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

async function setup(type: StoreType): Promise<Ctx> {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const customer = await registerUser(app);
  const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, { type });
  const product = await request(app)
    .post(`/api/v1/organizations/${org.id}/office-products`)
    .set(bearer(owner.accessToken))
    .send({ name: 'شامبو طبي', productType: 'CARE', price: '12500' });
  expect(product.status).toBe(201);
  return { admin, owner, customer, orgId: org.id, productId: product.body.data.id as string };
}

const addToCart = (ctx: Ctx, quantity = 1) =>
  request(app)
    .post(`/api/v1/organization-store/organizations/${ctx.orgId}/cart/items`)
    .set(bearer(ctx.customer.accessToken))
    .send({ productId: ctx.productId, quantity });

const checkout = (ctx: Ctx) =>
  request(app)
    .post(`/api/v1/organization-store/organizations/${ctx.orgId}/orders`)
    .set(bearer(ctx.customer.accessToken))
    .send(shipping);

const setStore = (token: string, orgId: string, enabled: boolean) =>
  request(app)
    .patch(`/api/v1/admin/organizations/${orgId}/store`)
    .set(bearer(token))
    .send({ enabled });

const setOrders = (token: string, orgId: string, ordersEnabled: boolean) =>
  request(app)
    .patch(`/api/v1/organizations/${orgId}/store-orders/settings`)
    .set(bearer(token))
    .send({ ordersEnabled });

describe('clinic specialty', () => {
  it('is required to register a clinic, saved, shown to the admin and editable', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);

    const missing = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({ termsAccepted: true, type: 'CLINIC', name: 'عيادة بلا تخصص' });
    expect(missing.status).toBe(422);
    expect(JSON.stringify(missing.body.error.details)).toContain('details.specialty');

    const created = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({
        termsAccepted: true,
        type: 'CLINIC',
        name: 'عيادة الرفق',
        details: { specialty: 'حيوانات أليفة' },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.details.specialty).toBe('حيوانات أليفة');
    const id = created.body.data.id as string;

    const adminView = await request(app)
      .get(`/api/v1/admin/organizations/${id}`)
      .set(bearer(admin.accessToken));
    expect(adminView.status).toBe(200);
    expect(adminView.body.data.details).toMatchObject({
      specialty: 'حيوانات أليفة',
      storeEnabled: true,
      ordersEnabled: true,
    });

    // Admin edits it; it can be changed but never cleared.
    const edited = await request(app)
      .patch(`/api/v1/organizations/${id}`)
      .set(bearer(admin.accessToken))
      .send({ specialty: 'دواجن' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.details.specialty).toBe('دواجن');
    const cleared = await request(app)
      .patch(`/api/v1/organizations/${id}`)
      .set(bearer(admin.accessToken))
      .send({ specialty: null });
    expect(cleared.status).toBe(422);
  });

  it('is public on the clinic page and rejected for a veterinary office', async () => {
    const ctx = await setup('CLINIC');
    const page = await request(app)
      .get(`/api/v1/organizations/discover/${ctx.orgId}`)
      .set(bearer(ctx.customer.accessToken));
    expect(page.status).toBe(200);
    expect(page.body.data).toMatchObject({
      specialty: 'عامة',
      storeEnabled: true,
      ordersEnabled: true,
    });

    const office = await setup('VETERINARY_OFFICE');
    const res = await request(app)
      .patch(`/api/v1/organizations/${office.orgId}`)
      .set(bearer(office.owner.accessToken))
      .send({ specialty: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('Admin clinic store switch', () => {
  it('OFF hides the store from customers (also via direct API) and keeps all data; ON restores it', async () => {
    const ctx = await setup('CLINIC');
    // A previous order + an open cart exist before the store is turned off.
    expect((await addToCart(ctx, 2)).status).toBe(201);
    const order = await checkout(ctx);
    expect(order.status).toBe(201);
    expect((await addToCart(ctx)).status).toBe(201);

    const off = await setStore(ctx.admin.accessToken, ctx.orgId, false);
    expect(off.status).toBe(200);
    expect(off.body.data.details.storeEnabled).toBe(false);

    const browse = await request(app)
      .get(`/api/v1/organizations/discover/${ctx.orgId}/office-products`)
      .set(bearer(ctx.customer.accessToken));
    expect(browse.status).toBe(403);
    expect(browse.body.error.code).toBe('STORE_DISABLED');
    const one = await request(app)
      .get(`/api/v1/organizations/discover/${ctx.orgId}/office-products/${ctx.productId}`)
      .set(bearer(ctx.customer.accessToken));
    expect(one.status).toBe(403);
    expect((await addToCart(ctx)).body.error.code).toBe('STORE_DISABLED');
    expect((await checkout(ctx)).body.error.code).toBe('STORE_DISABLED');
    const cart = await request(app)
      .get(`/api/v1/organization-store/organizations/${ctx.orgId}/cart`)
      .set(bearer(ctx.customer.accessToken));
    expect(cart.status).toBe(403);
    const carts = await request(app)
      .get('/api/v1/organization-store/carts')
      .set(bearer(ctx.customer.accessToken));
    expect(carts.body.data).toEqual([]);
    const page = await request(app)
      .get(`/api/v1/organizations/discover/${ctx.orgId}`)
      .set(bearer(ctx.customer.accessToken));
    expect(page.body.data.storeEnabled).toBe(false);

    // Nothing was deleted: products, the cart and the past order are intact,
    // and the customer still sees their order.
    expect(
      await getTestDb()('veterinary_office_products').where({ id: ctx.productId }),
    ).toHaveLength(1);
    expect(await getTestDb()('organization_store_cart_items')).toHaveLength(1);
    const mine = await request(app)
      .get(`/api/v1/organization-store/orders/${order.body.data.id}`)
      .set(bearer(ctx.customer.accessToken));
    expect(mine.status).toBe(200);

    const on = await setStore(ctx.admin.accessToken, ctx.orgId, true);
    expect(on.status).toBe(200);
    const again = await request(app)
      .get(`/api/v1/organizations/discover/${ctx.orgId}/office-products`)
      .set(bearer(ctx.customer.accessToken));
    expect(again.status).toBe(200);
    expect(again.body.data.map((p: { id: string }) => p.id)).toEqual([ctx.productId]);
    expect((await checkout(ctx)).status).toBe(201);
  });

  it('only an admin can switch it, and only for a clinic', async () => {
    const ctx = await setup('CLINIC');
    expect((await setStore(ctx.owner.accessToken, ctx.orgId, false)).status).toBe(403);
    expect((await setStore(ctx.customer.accessToken, ctx.orgId, false)).status).toBe(403);
    const office = await setup('VETERINARY_OFFICE');
    expect((await setStore(office.admin.accessToken, office.orgId, false)).status).toBe(400);
  });
});

describe.each(['CLINIC', 'VETERINARY_OFFICE'] as const)(
  '%s — receive new orders switch',
  (type) => {
    it('OFF blocks new carts / checkouts server-side; browsing and existing orders keep working', async () => {
      const ctx = await setup(type);
      expect((await addToCart(ctx)).status).toBe(201);
      const order = await checkout(ctx);
      expect(order.status).toBe(201);
      expect((await addToCart(ctx)).status).toBe(201);

      const off = await setOrders(ctx.owner.accessToken, ctx.orgId, false);
      expect(off.status).toBe(200);
      expect(off.body.data).toEqual({ ordersEnabled: false });
      const settings = await request(app)
        .get(`/api/v1/organizations/${ctx.orgId}/store-orders/settings`)
        .set(bearer(ctx.owner.accessToken));
      expect(settings.body.data).toEqual({ ordersEnabled: false });

      const add = await addToCart(ctx);
      expect(add.status).toBe(409);
      expect(add.body.error.code).toBe('STORE_ORDERS_DISABLED');
      const co = await checkout(ctx);
      expect(co.status).toBe(409);
      expect(co.body.error.code).toBe('STORE_ORDERS_DISABLED');

      // Browsing still works and says ordering is off.
      const browse = await request(app)
        .get(`/api/v1/organizations/discover/${ctx.orgId}/office-products`)
        .set(bearer(ctx.customer.accessToken));
      expect(browse.status).toBe(200);
      const page = await request(app)
        .get(`/api/v1/organizations/discover/${ctx.orgId}`)
        .set(bearer(ctx.customer.accessToken));
      expect(page.body.data.ordersEnabled).toBe(false);

      // The existing order is still managed by the seller.
      const confirm = await request(app)
        .patch(`/api/v1/organizations/${ctx.orgId}/store-orders/${order.body.data.id}/status`)
        .set(bearer(ctx.owner.accessToken))
        .send({ status: 'CONFIRMED' });
      expect(confirm.status).toBe(200);

      expect((await setOrders(ctx.owner.accessToken, ctx.orgId, true)).status).toBe(200);
      expect((await checkout(ctx)).status).toBe(201);
    });

    it('staff without store.order.manage and strangers cannot change it', async () => {
      const ctx = await setup(type);
      const staff = await registerUser(app);
      await addOrganizationMember(app, ctx.owner.accessToken, ctx.orgId, {
        userId: staff.id,
        role: 'STAFF',
      });
      expect((await setOrders(staff.accessToken, ctx.orgId, false)).status).toBe(403);
      expect((await setOrders(ctx.customer.accessToken, ctx.orgId, false)).status).toBe(403);
      expect((await addToCart(ctx)).status).toBe(201);
    });
  },
);
