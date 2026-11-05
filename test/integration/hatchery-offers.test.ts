import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  assignSystemSupervisor,
  bearer,
  registerAdmin,
  registerApprovedTrader,
  registerUser,
  seedStorageObject,
} from '../helpers/factories.js';

const storage = new InMemoryObjectStorage(null);
const { app } = buildTestApp({ objectStorage: storage });

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  storage.clear();
});
afterAll(() => closeTestDb());

async function createOffer(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(app)
    .post('/api/v1/hatchery-offers')
    .set(bearer(token))
    .send({
      chickType: 'BROILER',
      breed: 'Ross 308',
      chickAgeDays: 1,
      productionDate: '2026-11-5',
      governorate: 'نينوى',
      district: 'الموصل',
      phone: '+9647701234567',
      ...overrides,
    });
}

describe('hatchery offers (عروض المفاقس)', () => {
  it('create requires an eligible merchant or poultry farm (403 MARKET_ACCOUNT_REQUIRED)', async () => {
    const u = await registerUser(app);
    const res = await createOffer(u.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MARKET_ACCOUNT_REQUIRED');
  });

  it('stores the hatchery fields; the date is normalized to YYYY-MM-DD; quantity/price optional', async () => {
    const trader = await registerApprovedTrader(app);
    const res = await createOffer(trader.accessToken, { quantity: 5000, pricePerChick: '650' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      chickType: 'BROILER',
      breed: 'Ross 308',
      chickAgeDays: 1,
      productionDate: '2026-11-05',
      quantity: 5000,
      pricePerChick: '650.00',
      governorate: 'نينوى',
      district: 'الموصل',
      status: 'ACTIVE',
      moderationStatus: 'PENDING',
      traderUserId: trader.id,
      imageUrls: [],
    });

    const bare = await createOffer(trader.accessToken, { breed: undefined });
    expect(bare.status).toBe(201);
    expect(bare.body.data.quantity).toBeNull();
    expect(bare.body.data.pricePerChick).toBeNull();
    expect(bare.body.data.breed).toBeNull();
  });

  it('rejects invalid input (bad date, age out of range, unknown chick type) with 422', async () => {
    const trader = await registerApprovedTrader(app);
    expect((await createOffer(trader.accessToken, { productionDate: '2026-02-30' })).status).toBe(
      422,
    );
    expect((await createOffer(trader.accessToken, { chickAgeDays: 400 })).status).toBe(422);
    expect((await createOffer(trader.accessToken, { chickType: 'DRAGON' })).status).toBe(422);
  });

  it('a new offer is PENDING (not public) until a moderator approves it; rejection keeps it hidden', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    const stranger = await registerApprovedTrader(app);
    const res = await createOffer(trader.accessToken);
    const id = res.body.data.id as string;

    const before = await request(app)
      .get('/api/v1/hatchery-offers')
      .set(bearer(stranger.accessToken));
    expect(before.body.data).toHaveLength(0);
    expect(
      (await request(app).get(`/api/v1/hatchery-offers/${id}`).set(bearer(stranger.accessToken)))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/v1/hatchery-offers/${id}`).set(bearer(trader.accessToken)))
        .status,
    ).toBe(200);

    // the seller cannot approve their own ad
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/hatchery-offers/${id}/approve`)
          .set(bearer(trader.accessToken))
      ).status,
    ).toBe(403);

    // pending queue shows it to the moderator with the seller attached
    const queue = await request(app)
      .get('/api/v1/admin/hatchery-offers?moderationStatus=PENDING')
      .set(bearer(admin.accessToken));
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((o: { id: string }) => o.id)).toEqual([id]);
    expect(queue.body.data[0].seller).not.toBeNull();

    const approved = await request(app)
      .post(`/api/v1/admin/hatchery-offers/${id}/approve`)
      .set(bearer(admin.accessToken));
    expect(approved.status).toBe(200);
    expect(approved.body.data.moderationStatus).toBe('APPROVED');
    const again = await request(app)
      .post(`/api/v1/admin/hatchery-offers/${id}/approve`)
      .set(bearer(admin.accessToken));
    expect(again.status).toBe(409);

    const after = await request(app)
      .get('/api/v1/hatchery-offers')
      .set(bearer(stranger.accessToken));
    expect(after.body.data.map((o: { id: string }) => o.id)).toEqual([id]);

    const second = await createOffer(trader.accessToken);
    const rejected = await request(app)
      .post(`/api/v1/admin/hatchery-offers/${second.body.data.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'صور غير واضحة' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.moderationStatus).toBe('REJECTED');
    expect(rejected.body.data.rejectionReason).toBe('صور غير واضحة');
    const list = await request(app)
      .get('/api/v1/hatchery-offers')
      .set(bearer(stranger.accessToken));
    expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([id]);

    // the seller still sees both in "mine"
    const mine = await request(app)
      .get('/api/v1/hatchery-offers/mine')
      .set(bearer(trader.accessToken));
    expect(mine.body.data).toHaveLength(2);
  });

  it('a MARKET supervisor can moderate; the chickType filter applies', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'MARKET');
    for (const chickType of ['BROILER', 'LAYER']) {
      const o = await createOffer(trader.accessToken, { chickType });
      const ok = await request(app)
        .post(`/api/v1/admin/hatchery-offers/${o.body.data.id}/approve`)
        .set(bearer(sup.accessToken));
      expect(ok.status).toBe(200);
    }
    const layers = await request(app)
      .get('/api/v1/hatchery-offers?chickType=LAYER')
      .set(bearer(trader.accessToken));
    expect(layers.body.data).toHaveLength(1);
    expect(layers.body.data[0].chickType).toBe('LAYER');
  });

  it('only the owner or a moderator can delete', async () => {
    const trader = await registerApprovedTrader(app);
    const other = await registerApprovedTrader(app);
    const created = await createOffer(trader.accessToken);
    const offerId = created.body.data.id as string;
    expect(
      (
        await request(app)
          .delete(`/api/v1/hatchery-offers/${offerId}`)
          .set(bearer(other.accessToken))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`/api/v1/hatchery-offers/${offerId}`)
          .set(bearer(trader.accessToken))
      ).status,
    ).toBe(200);
    const admin = await registerAdmin(app);
    const second = await createOffer(trader.accessToken);
    const del = await request(app)
      .delete(`/api/v1/admin/hatchery-offers/${second.body.data.id}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(200);
    const removed = await request(app)
      .get('/api/v1/admin/hatchery-offers?status=REMOVED')
      .set(bearer(admin.accessToken));
    expect(removed.body.data).toHaveLength(2);
  });

  it('accepts uploaded photos under the hatchery prefix only', async () => {
    const trader = await registerApprovedTrader(app);
    const upload = await request(app)
      .post('/api/v1/hatchery-offers/upload-url')
      .set(bearer(trader.accessToken))
      .send({ filename: 'chicks.png', mimeType: 'image/png', size: 2048 });
    expect(upload.status).toBe(201);
    expect(
      (upload.body.data.storageKey as string).startsWith(`${StoragePrefix.hatcheryOfferImages}/`),
    ).toBe(true);

    const { storageKey } = await seedStorageObject(
      storage,
      StoragePrefix.hatcheryOfferImages,
      Buffer.alloc(10, 1),
      'image/png',
    );
    const ok = await createOffer(trader.accessToken, { galleryKeys: [storageKey] });
    expect(ok.status).toBe(201);
    expect(ok.body.data.imageUrls).toHaveLength(1);

    const egg = await seedStorageObject(
      storage,
      StoragePrefix.eggOfferImages,
      Buffer.alloc(10, 1),
      'image/png',
    );
    const wrongPrefix = await createOffer(trader.accessToken, { galleryKeys: [egg.storageKey] });
    expect(wrongPrefix.status).toBe(409);
    const missing = await createOffer(trader.accessToken, {
      galleryKeys: [`${StoragePrefix.hatcheryOfferImages}/2026/11/never-uploaded.png`],
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('STORAGE_OBJECT_MISSING');
  });

  it('admin dashboard counts pending hatchery offers in the poultry market hub', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    await createOffer(trader.accessToken);
    await createOffer(trader.accessToken);
    const summary = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(admin.accessToken));
    expect(summary.status).toBe(200);
    const card = (
      summary.body.data.cards as Array<{ id: string; sectionCounts?: Record<string, number> }>
    ).find((c) => c.id === 'poultryMarket');
    expect(card?.sectionCounts?.hatcheryOffers).toBe(2);
  });
});
