import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createFarm,
  createPetStoreProduct,
  createVetStoreProduct,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

type Group = { type: string; total: number; items: { id: string; title: string }[] };
const groupOf = (res: request.Response, type: string): Group | undefined =>
  (res.body.data.groups as Group[]).find((g) => g.type === type);

describe('GET /search — Home header global search', () => {
  it('finds matching entities per type, scoped by each type’s visibility rules', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);
    const stranger = await registerUser(app);

    await createPetStoreProduct(app, admin.accessToken, { name: 'طعام نيوكاسل للقطط' });
    await createVetStoreProduct(app, admin.accessToken, { name: 'لقاح نيوكاسل' });
    const clinic = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة نيوكاسل',
    });
    const pending = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({ type: 'CLINIC', name: 'عيادة نيوكاسل المعلقة', termsAccepted: true });
    expect(pending.status).toBe(201);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, {
      name: 'مزرعة نيوكاسل',
    });

    const asOwner = await request(app)
      .get('/api/v1/search')
      .query({ q: 'نيوكاسل' })
      .set(bearer(owner.accessToken));
    expect(asOwner.status).toBe(200);
    expect(groupOf(asOwner, 'PET_STORE_PRODUCT')?.items[0]?.title).toBe('طعام نيوكاسل للقطط');
    // only ACTIVE clinics — never the pending one
    expect(groupOf(asOwner, 'CLINIC')?.items.map((i) => i.id)).toEqual([clinic.id]);
    // own farm found
    expect(groupOf(asOwner, 'FARM')?.items.map((i) => i.id)).toEqual([farm.id]);
    // the Veterinarian Store is not searchable by a non-vet
    expect(groupOf(asOwner, 'VET_STORE_PRODUCT')).toBeUndefined();

    // someone else's farm is never exposed; the vet store is, for an approved vet
    const asStranger = await request(app)
      .get('/api/v1/search')
      .query({ q: 'نيوكاسل' })
      .set(bearer(stranger.accessToken));
    expect(groupOf(asStranger, 'FARM')).toBeUndefined();
    const asVet = await request(app)
      .get('/api/v1/search')
      .query({ q: 'نيوكاسل', types: 'VET_STORE_PRODUCT,CLINIC', limit: 3 })
      .set(bearer(vet.accessToken));
    expect(groupOf(asVet, 'VET_STORE_PRODUCT')?.items[0]?.title).toBe('لقاح نيوكاسل');
    expect((asVet.body.data.groups as Group[]).map((g) => g.type).sort()).toEqual([
      'CLINIC',
      'VET_STORE_PRODUCT',
    ]);

    // an expired clinic drops out like in the directory
    await getTestDb()('clinic_details')
      .where({ organization_id: clinic.id })
      .update({ subscription_start_date: '2025-01-01', subscription_end_date: '2025-06-30' });
    const afterExpiry = await request(app)
      .get('/api/v1/search')
      .query({ q: 'نيوكاسل', types: 'CLINIC' })
      .set(bearer(owner.accessToken));
    expect(groupOf(afterExpiry, 'CLINIC')).toBeUndefined();
  });

  it('validates the query and requires authentication', async () => {
    const user = await registerUser(app);
    const tooShort = await request(app).get('/api/v1/search?q=a').set(bearer(user.accessToken));
    expect(tooShort.status).toBe(422);
    const badType = await request(app)
      .get('/api/v1/search?q=abc&types=NOPE')
      .set(bearer(user.accessToken));
    expect(badType.status).toBe(422);
    const anon = await request(app).get('/api/v1/search?q=abc');
    expect(anon.status).toBe(401);
  });
});
