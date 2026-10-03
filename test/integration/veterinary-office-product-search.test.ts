import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('Veterinary Office — product search by name, brand and country', () => {
  it('filters the public catalog by text, brand and country, and exposes facets', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const shopper = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const manage = `/api/v1/organizations/${office.id}/office-products`;
    const add = (body: Record<string, unknown>) =>
      request(app)
        .post(manage)
        .set(bearer(owner.accessToken))
        .send({ productType: 'MEDICINE', price: '1000', stockQuantity: 3, ...body });

    const a = await add({ name: 'أموكسيسيلين', brand: 'Bayer', countryOfOrigin: 'ألمانيا' });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ brand: 'Bayer', countryOfOrigin: 'ألمانيا' });
    const b = await add({ name: 'إيفرمكتين', brand: 'bayer', countryOfOrigin: 'تركيا' });
    const c = await add({ name: 'فيتامين AD3', brand: 'Zoetis', countryOfOrigin: 'ألمانيا' });
    // a hidden product never shows publicly (nor in facets)
    await add({ name: 'منتج مخفي', brand: 'Hidden Co', countryOfOrigin: 'الصين' }).then((h) =>
      request(app)
        .patch(`${manage}/${h.body.data.id}`)
        .set(bearer(owner.accessToken))
        .send({ isHidden: true }),
    );

    const pub = `/api/v1/organizations/discover/${office.id}/office-products`;
    const ids = async (query: Record<string, string>) => {
      const res = await request(app).get(pub).query(query).set(bearer(shopper.accessToken));
      expect(res.status).toBe(200);
      return (res.body.data as { id: string }[]).map((p) => p.id).sort();
    };

    expect(await ids({ brand: 'BAYER' })).toEqual([a.body.data.id, b.body.data.id].sort());
    expect(await ids({ country: 'ألمانيا' })).toEqual([a.body.data.id, c.body.data.id].sort());
    expect(await ids({ brand: 'bayer', country: 'تركيا' })).toEqual([b.body.data.id]);
    // text search also matches the brand, not only the name
    expect(await ids({ search: 'zoet' })).toEqual([c.body.data.id]);
    expect(await ids({ search: 'إيفر' })).toEqual([b.body.data.id]);
    // LIKE wildcards in input are literal
    expect(await ids({ search: '%' })).toEqual([]);

    const facets = await request(app).get(`${pub}/facets`).set(bearer(shopper.accessToken));
    expect(facets.status).toBe(200);
    expect(facets.body.data.brands).toHaveLength(2); // Bayer/bayer collapse; hidden excluded
    expect(facets.body.data.countries.sort()).toEqual(['ألمانيا', 'تركيا'].sort());
  });
});
