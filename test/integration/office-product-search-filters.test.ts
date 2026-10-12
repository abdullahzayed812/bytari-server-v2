import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const SEARCH = '/api/v1/office-products/search';
const FACETS = '/api/v1/office-products/facets';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('cross-office product search — filter by brand / country of origin', () => {
  it('returns only matching public products, with cross-office facets', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const ownerC = await registerApprovedVet(app);
    const shopper = await registerUser(app);
    const mk = (token: string, name: string) =>
      createActiveOrganization(app, token, admin.accessToken, { type: 'VETERINARY_OFFICE', name });
    const officeA = await mk(ownerA.accessToken, 'Office A');
    const officeB = await mk(ownerB.accessToken, 'Office B');
    const expired = await mk(ownerC.accessToken, 'Office Expired');

    const add = async (orgId: string, token: string, body: Record<string, unknown>) => {
      const r = await request(app)
        .post(`/api/v1/organizations/${orgId}/office-products`)
        .set(bearer(token))
        .send({ productType: 'MEDICINE', price: '1000', stockQuantity: 3, ...body });
      expect(r.status).toBe(201);
      return r.body.data.id as string;
    };
    await add(officeA.id, ownerA.accessToken, {
      name: 'P1',
      brand: 'Bayer',
      countryOfOrigin: 'ألمانيا',
    });
    await add(officeB.id, ownerB.accessToken, {
      name: 'P2',
      brand: 'Zoetis',
      countryOfOrigin: 'أمريكا',
    });
    // B's only Bayer product is hidden → B must not match "bayer"
    const hidden = await add(officeB.id, ownerB.accessToken, { name: 'P3', brand: 'bayer' });
    await request(app)
      .patch(`/api/v1/organizations/${officeB.id}/office-products/${hidden}`)
      .set(bearer(ownerB.accessToken))
      .send({ isHidden: true })
      .expect(200);
    await add(expired.id, ownerC.accessToken, {
      name: 'P4',
      brand: 'Bayer',
      countryOfOrigin: 'فرنسا',
    });
    await getTestDb()('veterinary_office_details')
      .where({ organization_id: expired.id })
      .update({ subscription_end_date: '2020-01-01' });

    const names = async (query: Record<string, string>) => {
      const res = await request(app)
        .get(SEARCH)
        .query(query)
        .set(bearer(shopper.accessToken))
        .expect(200);
      return (res.body.data as Array<{ product: { name: string } }>)
        .map((h) => h.product.name)
        .sort();
    };

    // case-insensitive; hidden products and expired offices never match
    expect(await names({ brand: 'BAYER' })).toEqual(['P1']);
    expect(await names({ country: 'أمريكا' })).toEqual(['P2']);
    expect(await names({ brand: 'Bayer', country: 'أمريكا' })).toEqual([]);
    expect(await names({ brand: 'zoetis', search: 'P2' })).toEqual(['P2']);
    expect(await names({})).toEqual(['P1', 'P2']);

    // the offices list no longer filters by product brand / country (param ignored)
    const offices = await request(app)
      .get('/api/v1/organizations/discover')
      .query({ type: 'VETERINARY_OFFICE', productBrand: 'Zoetis' })
      .set(bearer(shopper.accessToken))
      .expect(200);
    expect((offices.body.data as Array<{ id: string }>).map((o) => o.id).sort()).toEqual(
      [officeA.id, officeB.id].sort(),
    );

    const facets = await request(app).get(FACETS).set(bearer(shopper.accessToken)).expect(200);
    // hidden products and expired offices contribute nothing
    expect(facets.body.data.brands).toEqual(['Bayer', 'Zoetis']);
    expect([...facets.body.data.countries].sort()).toEqual(['أمريكا', 'ألمانيا'].sort());
  });

  it('facets require authentication', async () => {
    await request(app).get(FACETS).expect(401);
  });
});
