import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const SEARCH = '/api/v1/office-products/search';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('GET /office-products/search — products across every Veterinary Office', () => {
  it('returns matching products from all public offices, each with its office', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const ownerC = await registerApprovedVet(app);
    const ownerD = await registerApprovedVet(app);
    const shopper = await registerUser(app);
    const officeA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب الرافدين',
    });
    const officeB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب دجلة',
    });
    const expired = await createActiveOrganization(app, ownerC.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Expired Office',
    });
    const pending = await createOrganization(app, ownerD.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Pending Office',
    });

    const add = (orgId: string, token: string, body: Record<string, unknown>) =>
      request(app)
        .post(`/api/v1/organizations/${orgId}/office-products`)
        .set(bearer(token))
        .send({ productType: 'MEDICINE', price: '1000', stockQuantity: 3, ...body });

    const a1 = await add(officeA.id, ownerA.accessToken, {
      name: 'أموكسيسيلين 500',
      brand: 'Bayer',
    });
    expect(a1.status).toBe(201);
    const b1 = await add(officeB.id, ownerB.accessToken, {
      name: 'Amoxicillin Vet',
      description: 'أموكسيسيلين بيطري',
    });
    expect(b1.status).toBe(201);
    await add(officeA.id, ownerA.accessToken, { name: 'فيتامين AD3' });
    // hidden product → never listed
    const hidden = await add(officeB.id, ownerB.accessToken, { name: 'أموكسيسيلين مخفي' });
    await request(app)
      .patch(`/api/v1/organizations/${officeB.id}/office-products/${hidden.body.data.id}`)
      .set(bearer(ownerB.accessToken))
      .send({ isHidden: true })
      .expect(200);
    // expired office → off the market
    await add(expired.id, ownerC.accessToken, { name: 'أموكسيسيلين قديم' }).then((r) =>
      expect(r.status).toBe(201),
    );
    await getTestDb()('veterinary_office_details')
      .where({ organization_id: expired.id })
      .update({ subscription_end_date: '2020-01-01' });
    // a not-yet-approved office's products are never public
    await getTestDb()('veterinary_office_products').insert({
      organization_id: pending.id,
      name: 'أموكسيسيلين معلق',
      product_type: 'MEDICINE',
      status: 'ACTIVE',
      stock_quantity: 1,
      created_by_user_id: ownerD.id,
    });

    const res = await request(app)
      .get(SEARCH)
      .query({ search: 'أموكسيسيلين' })
      .set(bearer(shopper.accessToken))
      .expect(200);
    const hits = res.body.data as Array<{
      product: { id: string; name: string; price: string | null };
      office: { id: string; name: string; logoUrl: string | null };
    }>;
    expect(hits.map((h) => h.product.id).sort()).toEqual([a1.body.data.id, b1.body.data.id].sort());
    expect(res.body.meta.total).toBe(2);
    const fromA = hits.find((h) => h.product.id === a1.body.data.id)!;
    expect(fromA.office).toMatchObject({ id: officeA.id, name: 'مكتب الرافدين' });
    expect(fromA.product).toMatchObject({
      name: 'أموكسيسيلين 500',
      brand: 'Bayer',
      price: '1000.00',
    });
    const fromB = hits.find((h) => h.product.id === b1.body.data.id)!;
    expect(fromB.office).toMatchObject({ id: officeB.id, name: 'مكتب دجلة' });

    // name matches rank first (prefix), every word must match, pagination works
    const page1 = await request(app)
      .get(SEARCH)
      .query({ search: 'أموكسيسيلين', pageSize: 1, page: 1 })
      .set(bearer(shopper.accessToken))
      .expect(200);
    expect(page1.body.data[0].product.id).toBe(a1.body.data.id);
    expect(page1.body.meta).toMatchObject({ total: 2, totalPages: 2 });
    const twoWords = await request(app)
      .get(SEARCH)
      .query({ search: 'أموكسيسيلين bayer' })
      .set(bearer(shopper.accessToken))
      .expect(200);
    expect(twoWords.body.data.map((h: { product: { id: string } }) => h.product.id)).toEqual([
      a1.body.data.id,
    ]);
    // no search → every public product (3 visible across A and B)
    const all = await request(app).get(SEARCH).set(bearer(shopper.accessToken)).expect(200);
    expect(all.body.meta.total).toBe(3);
  });

  it('requires authentication and validates the query', async () => {
    await request(app).get(SEARCH).query({ search: 'x' }).expect(401);
    const u = await registerUser(app);
    await request(app).get(SEARCH).query({ type: 'NOPE' }).set(bearer(u.accessToken)).expect(422);
  });
});
