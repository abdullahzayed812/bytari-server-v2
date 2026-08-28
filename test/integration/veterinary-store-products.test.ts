import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  adjustProductStock,
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  createProduct,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const staff = await registerUser(app);
  const store = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
    type: 'VETERINARY_STORE',
    name: 'Vet Supplies Co',
  });
  await addOrganizationMember(app, owner.accessToken, store.id, {
    userId: staff.id,
    role: 'STAFF',
  });
  return { admin, owner, staff, store };
}

const pPath = (orgId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/products${id ? `/${id}` : ''}`;

describe('veterinary store products — CRUD', () => {
  it('an owner creates, reads, lists, updates and deactivates a product', async () => {
    const { owner, store } = await setup();

    const create = await request(app).post(pPath(store.id)).set(bearer(owner.accessToken)).send({
      name: 'Amoxicillin 250mg',
      description: '100 tablets',
      productType: 'MEDICINE',
      price: '19.99',
      stockQuantity: 40,
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({
      organizationId: store.id,
      name: 'Amoxicillin 250mg',
      productType: 'MEDICINE',
      price: '19.99',
      stockQuantity: 40,
      status: 'ACTIVE',
      createdByUserId: owner.id,
    });
    // price is a string, never a float
    expect(typeof create.body.data.price).toBe('string');

    const read = await request(app).get(pPath(store.id, id)).set(bearer(owner.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data.description).toBe('100 tablets');

    const list = await request(app).get(pPath(store.id)).set(bearer(owner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(pPath(store.id, id))
      .set(bearer(owner.accessToken))
      .send({ price: '17.50', productType: 'SUPPLY' });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ price: '17.50', productType: 'SUPPLY' });

    const del = await request(app).delete(pPath(store.id, id)).set(bearer(owner.accessToken));
    expect(del.status).toBe(200);
    expect(del.body.data.status).toBe('INACTIVE');
    // soft-delete: the row is still there
    expect(await getTestDb()('products').where({ id })).toHaveLength(1);

    // deactivation is idempotent
    const del2 = await request(app).delete(pPath(store.id, id)).set(bearer(owner.accessToken));
    expect(del2.status).toBe(200);
    expect(del2.body.data.status).toBe('INACTIVE');
  });

  it('rejects invalid product type / negative price / empty body (422)', async () => {
    const { owner, store } = await setup();
    for (const bad of [
      { name: 'x', productType: 'DRUG' },
      { name: 'x', productType: 'MEDICINE', price: '-5' },
      { name: 'x', productType: 'MEDICINE', price: '12.999' },
      { name: '', productType: 'MEDICINE' },
    ]) {
      const res = await request(app).post(pPath(store.id)).set(bearer(owner.accessToken)).send(bad);
      expect(res.status).toBe(422);
    }
    const prod = await createProduct(app, owner.accessToken, store.id);
    const emptyPatch = await request(app)
      .patch(pPath(store.id, prod.id))
      .set(bearer(owner.accessToken))
      .send({});
    expect(emptyPatch.status).toBe(422);
  });

  it('supports type / status filters and sorting', async () => {
    const { owner, store } = await setup();
    await createProduct(app, owner.accessToken, store.id, {
      name: 'B-med',
      productType: 'MEDICINE',
      price: '30.00',
    });
    await createProduct(app, owner.accessToken, store.id, {
      name: 'A-equip',
      productType: 'EQUIPMENT',
      price: '10.00',
    });

    const meds = await request(app)
      .get(`${pPath(store.id)}?type=MEDICINE`)
      .set(bearer(owner.accessToken));
    expect(meds.body.data).toHaveLength(1);
    expect(meds.body.data[0].name).toBe('B-med');

    const byName = await request(app)
      .get(`${pPath(store.id)}?sort=name&order=asc`)
      .set(bearer(owner.accessToken));
    expect((byName.body.data as Array<{ name: string }>).map((p) => p.name)).toEqual([
      'A-equip',
      'B-med',
    ]);
  });

  it('ignores a client-supplied organizationId / createdBy / status / stockQuantity on update', async () => {
    const { admin, owner, store } = await setup();
    const otherStore = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_STORE',
      name: 'Other Store',
    });
    const prod = await createProduct(app, owner.accessToken, store.id, { stockQuantity: 5 });

    const res = await request(app)
      .patch(pPath(store.id, prod.id))
      .set(bearer(owner.accessToken))
      .send({
        name: 'Renamed',
        organizationId: otherStore.id,
        createdByUserId: admin.id,
        stockQuantity: 9999,
        id: '00000000-0000-0000-0000-000000000001',
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Renamed',
      organizationId: store.id,
      createdByUserId: owner.id,
      stockQuantity: 5,
      id: prod.id,
    });
  });
});

describe('veterinary store products — organization type gate', () => {
  it('rejects product operations on non-store organizations with 400', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    for (const type of ['CLINIC', 'FARM', 'VETERINARY_OFFICE'] as const) {
      const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type,
        name: `${type} org`,
      });
      const res = await request(app)
        .post(pPath(org.id))
        .set(bearer(owner.accessToken))
        .send({ name: 'x', productType: 'MEDICINE' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
    }
  });

  it('the database composite FK refuses a product pointing at a non-store organization', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    await expect(
      getTestDb()('products').insert({
        organization_id: clinic.id,
        organization_type: 'VETERINARY_STORE',
        name: 'illegal',
        product_type: 'MEDICINE',
      }),
    ).rejects.toThrow();
  });
});

describe('veterinary store products — authorization', () => {
  it('a STAFF member can read but not create / update / delete', async () => {
    const { owner, staff, store } = await setup();
    const prod = await createProduct(app, owner.accessToken, store.id);

    const read = await request(app).get(pPath(store.id)).set(bearer(staff.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data).toHaveLength(1);

    const create = await request(app)
      .post(pPath(store.id))
      .set(bearer(staff.accessToken))
      .send({ name: 'x', productType: 'MEDICINE' });
    expect(create.status).toBe(403);

    const upd = await request(app)
      .patch(pPath(store.id, prod.id))
      .set(bearer(staff.accessToken))
      .send({ name: 'y' });
    expect(upd.status).toBe(403);
  });

  it('a SUPERVISOR gets only the explicitly-assigned product permissions', async () => {
    const { owner, store } = await setup();
    const supervisor = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, owner.accessToken, store.id, {
      userId: supervisor.id,
      permissions: ['product.read', 'product.create'],
    });
    const prod = await createProduct(app, owner.accessToken, store.id);

    const read = await request(app).get(pPath(store.id)).set(bearer(supervisor.accessToken));
    expect(read.status).toBe(200);

    const create = await request(app)
      .post(pPath(store.id))
      .set(bearer(supervisor.accessToken))
      .send({ name: 'Sup product', productType: 'EQUIPMENT' });
    expect(create.status).toBe(201);

    // NOT assigned: product.update / product.delete / product.inventory.adjust
    const upd = await request(app)
      .patch(pPath(store.id, prod.id))
      .set(bearer(supervisor.accessToken))
      .send({ name: 'z' });
    expect(upd.status).toBe(403);

    const del = await request(app)
      .delete(pPath(store.id, prod.id))
      .set(bearer(supervisor.accessToken));
    expect(del.status).toBe(403);

    const stock = await adjustProductStock(app, supervisor.accessToken, store.id, prod.id, 5);
    expect(stock.status).toBe(403);
  });

  it('a non-member (pet owner) is denied (403)', async () => {
    const { store } = await setup();
    const stranger = await registerUser(app);
    const res = await request(app).get(pPath(store.id)).set(bearer(stranger.accessToken));
    expect(res.status).toBe(403);
  });

  it('an ADMIN can manage any store’s products (global override)', async () => {
    const { admin, store } = await setup();
    const res = await request(app)
      .post(pPath(store.id))
      .set(bearer(admin.accessToken))
      .send({ name: 'Admin product', productType: 'OTHER' });
    expect(res.status).toBe(201);
  });
});

describe('veterinary store products — cross-store IDOR', () => {
  it('a member of Store B cannot read / patch / delete Store A’s product', async () => {
    const { owner: ownerA, store: storeA } = await setup();
    const prodA = await createProduct(app, ownerA.accessToken, storeA.id);

    const admin2 = await registerAdmin(app);
    const ownerB = await registerApprovedVet(app);
    const storeB = await createActiveOrganization(app, ownerB.accessToken, admin2.accessToken, {
      type: 'VETERINARY_STORE',
      name: 'Store B',
    });

    // Store B owner is not a member of Store A → 403 on the collection
    const listA = await request(app).get(pPath(storeA.id)).set(bearer(ownerB.accessToken));
    expect(listA.status).toBe(403);

    // Store A's product id under Store B's URL → 404 (not visible)
    const readUnderB = await request(app)
      .get(pPath(storeB.id, prodA.id))
      .set(bearer(ownerB.accessToken));
    expect(readUnderB.status).toBe(404);

    const patchUnderB = await request(app)
      .patch(pPath(storeB.id, prodA.id))
      .set(bearer(ownerB.accessToken))
      .send({ name: 'tampered' });
    expect(patchUnderB.status).toBe(404);

    const deleteUnderB = await request(app)
      .delete(pPath(storeB.id, prodA.id))
      .set(bearer(ownerB.accessToken));
    expect(deleteUnderB.status).toBe(404);

    // Store A's product is untouched
    const row = (await getTestDb()('products').where({ id: prodA.id }).first()) as {
      name: string;
      status: string;
    };
    expect(row.status).toBe('ACTIVE');
    expect(row.name).not.toBe('tampered');
  });
});

describe('veterinary store products — inventory', () => {
  it('adjusts stock by a signed delta and records the movement in the audit metadata', async () => {
    const { owner, store } = await setup();
    const prod = await createProduct(app, owner.accessToken, store.id, { stockQuantity: 10 });

    const up = await adjustProductStock(app, owner.accessToken, store.id, prod.id, 15, 'restock');
    expect(up.status).toBe(200);
    expect(up.body.data.stockQuantity).toBe(25);

    const down = await adjustProductStock(app, owner.accessToken, store.id, prod.id, -5);
    expect(down.status).toBe(200);
    expect(down.body.data.stockQuantity).toBe(20);

    const adj = (await getTestDb()('audit_logs')
      .where({ action: 'PRODUCT_INVENTORY_ADJUSTED', entity_id: prod.id })
      .orderBy('created_at', 'asc')
      .select('actor_user_id', 'metadata')) as Array<{
      actor_user_id: string;
      metadata: Record<string, unknown>;
    }>;
    expect(adj).toHaveLength(2);
    expect(adj[0]).toMatchObject({ actor_user_id: owner.id });
    expect(adj[0]?.metadata).toMatchObject({
      organizationId: store.id,
      productId: prod.id,
      delta: 15,
      previousQuantity: 10,
      newQuantity: 25,
      reason: 'restock',
    });
  });

  it('refuses an adjustment that would take stock below zero (409)', async () => {
    const { owner, store } = await setup();
    const prod = await createProduct(app, owner.accessToken, store.id, { stockQuantity: 3 });

    const res = await adjustProductStock(app, owner.accessToken, store.id, prod.id, -10);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');

    const row = (await getTestDb()('products').where({ id: prod.id }).first()) as {
      stock_quantity: number;
    };
    expect(Number(row.stock_quantity)).toBe(3);
  });

  it('rejects a zero delta with 422', async () => {
    const { owner, store } = await setup();
    const prod = await createProduct(app, owner.accessToken, store.id);
    const res = await adjustProductStock(app, owner.accessToken, store.id, prod.id, 0);
    expect(res.status).toBe(422);
  });

  it('a generic PATCH cannot change stock', async () => {
    const { owner, store } = await setup();
    const prod = await createProduct(app, owner.accessToken, store.id, { stockQuantity: 7 });
    const res = await request(app)
      .patch(pPath(store.id, prod.id))
      .set(bearer(owner.accessToken))
      .send({ stockQuantity: 999, name: 'still works' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'still works', stockQuantity: 7 });
  });
});

describe('veterinary store products — events & audit', () => {
  it('create / update / deactivate write audit with the acting user and IDs', async () => {
    const { owner, store } = await setup();
    const prod = await createProduct(app, owner.accessToken, store.id);
    await request(app)
      .patch(pPath(store.id, prod.id))
      .set(bearer(owner.accessToken))
      .send({ name: 'v2' });
    await request(app).delete(pPath(store.id, prod.id)).set(bearer(owner.accessToken));

    const rows = (await getTestDb()('audit_logs')
      .where({ entity_id: prod.id })
      .orderBy('created_at', 'asc')
      .select('action', 'actor_user_id', 'metadata')) as Array<{
      action: string;
      actor_user_id: string;
      metadata: Record<string, unknown>;
    }>;
    expect(rows.map((r) => r.action)).toEqual([
      'PRODUCT_CREATED',
      'PRODUCT_UPDATED',
      'PRODUCT_DEACTIVATED',
    ]);
    for (const r of rows) {
      expect(r.actor_user_id).toBe(owner.id);
      expect(r.metadata).toMatchObject({ organizationId: store.id, productId: prod.id });
      expect(JSON.stringify(r.metadata).toLowerCase()).not.toContain('password');
    }
  });

  it('a failed create (non-store org) writes no audit', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Office',
    });
    await request(app)
      .post(pPath(office.id))
      .set(bearer(owner.accessToken))
      .send({ name: 'x', productType: 'MEDICINE' });

    const cnt = await getTestDb()('audit_logs')
      .where({ action: 'PRODUCT_CREATED' })
      .count<{ count: string }>({ count: '*' })
      .first();
    expect(Number(cnt?.count ?? 0)).toBe(0);
  });
});
