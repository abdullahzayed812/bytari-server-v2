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
    .post('/api/v1/poultry-offers')
    .set(bearer(token))
    .send({
      birdType: 'BROILER',
      quantity: 2000,
      pricingMethod: 'PER_KG',
      price: '3000',
      governorate: 'نينوى',
      phone: '+9647701234567',
      ...overrides,
    });
}

describe('poultry market offers', () => {
  it('create requires an approved trader (403 TRADER_APPROVAL_REQUIRED)', async () => {
    const u = await registerUser(app);
    const res = await createOffer(u.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TRADER_APPROVAL_REQUIRED');
  });

  it('a new ad is PENDING (not public) until a moderator approves it; rejection keeps it hidden', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    const stranger = await registerUser(app);
    const res = await createOffer(trader.accessToken, { breed: 'محلية', ageWeeks: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.moderationStatus).toBe('PENDING');
    expect(res.body.data.traderUserId).toBe(trader.id);
    const id = res.body.data.id as string;

    const before = await request(app)
      .get('/api/v1/poultry-offers')
      .set(bearer(stranger.accessToken));
    expect(before.body.data.some((o: { id: string }) => o.id === id)).toBe(false);
    // Only the trader (and moderators) can open a pending ad.
    expect(
      (await request(app).get(`/api/v1/poultry-offers/${id}`).set(bearer(stranger.accessToken)))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/v1/poultry-offers/${id}`).set(bearer(trader.accessToken)))
        .status,
    ).toBe(200);

    // A trader cannot approve their own ad; a moderator can.
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/poultry-offers/${id}/approve`)
          .set(bearer(trader.accessToken))
      ).status,
    ).toBe(403);
    const approve = await request(app)
      .post(`/api/v1/admin/poultry-offers/${id}/approve`)
      .set(bearer(admin.accessToken));
    expect(approve.status).toBe(200);
    expect(approve.body.data.moderationStatus).toBe('APPROVED');
    const again = await request(app)
      .post(`/api/v1/admin/poultry-offers/${id}/approve`)
      .set(bearer(admin.accessToken));
    expect(again.status).toBe(409);

    const after = await request(app)
      .get('/api/v1/poultry-offers')
      .set(bearer(stranger.accessToken));
    expect(after.body.data.some((o: { id: string }) => o.id === id)).toBe(true);

    const second = await createOffer(trader.accessToken);
    const reject = await request(app)
      .post(`/api/v1/admin/poultry-offers/${second.body.data.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'سعر غير واقعي' });
    expect(reject.status).toBe(200);
    expect(reject.body.data).toMatchObject({
      moderationStatus: 'REJECTED',
      rejectionReason: 'سعر غير واقعي',
    });
    const list = await request(app).get('/api/v1/poultry-offers').set(bearer(stranger.accessToken));
    expect(list.body.data.some((o: { id: string }) => o.id === second.body.data.id)).toBe(false);
  });

  it('filters by birdType and governorate', async () => {
    const trader = await registerApprovedTrader(app);
    const o1 = await createOffer(trader.accessToken, { birdType: 'BROILER', governorate: 'نينوى' });
    const o2 = await createOffer(trader.accessToken, { birdType: 'LAYER', governorate: 'بغداد' });
    const admin = await registerAdmin(app);
    for (const o of [o1, o2]) {
      await request(app)
        .post(`/api/v1/admin/poultry-offers/${o.body.data.id}/approve`)
        .set(bearer(admin.accessToken));
    }

    const byBird = await request(app)
      .get('/api/v1/poultry-offers?birdType=LAYER')
      .set(bearer(trader.accessToken));
    expect(byBird.body.data).toHaveLength(1);
    expect(byBird.body.data[0].birdType).toBe('LAYER');

    const byGov = await request(app)
      .get('/api/v1/poultry-offers?governorate=%D9%86%D9%8A%D9%86%D9%88%D9%89')
      .set(bearer(trader.accessToken));
    expect(byGov.body.data).toHaveLength(1);
    expect(byGov.body.data[0].governorate).toBe('نينوى');
  });

  it('owner can delete their own offer; a different trader gets 403', async () => {
    const trader = await registerApprovedTrader(app);
    const other = await registerApprovedTrader(app);
    const created = await createOffer(trader.accessToken);
    const offerId = created.body.data.id as string;

    const forbidden = await request(app)
      .delete(`/api/v1/poultry-offers/${offerId}`)
      .set(bearer(other.accessToken));
    expect(forbidden.status).toBe(403);

    const removed = await request(app)
      .delete(`/api/v1/poultry-offers/${offerId}`)
      .set(bearer(trader.accessToken));
    expect(removed.status).toBe(200);

    const get = await request(app)
      .get(`/api/v1/poultry-offers/${offerId}`)
      .set(bearer(trader.accessToken));
    expect(get.body.data.status).toBe('REMOVED');
  });

  it('admin can delete any offer via market.offer.admin.delete', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    const created = await createOffer(trader.accessToken);
    const offerId = created.body.data.id as string;

    const removed = await request(app)
      .delete(`/api/v1/poultry-offers/${offerId}`)
      .set(bearer(admin.accessToken));
    expect(removed.status).toBe(200);
  });

  it('a MARKET system-supervisor can delete any offer, but an unassigned user cannot', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    const specialist = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, specialist.id, 'MARKET');

    const created = await createOffer(trader.accessToken);
    const offerId = created.body.data.id as string;
    const removed = await request(app)
      .delete(`/api/v1/poultry-offers/${offerId}`)
      .set(bearer(specialist.accessToken));
    expect(removed.status).toBe(200);

    const created2 = await createOffer(trader.accessToken);
    const stranger = await registerUser(app);
    const denied = await request(app)
      .delete(`/api/v1/poultry-offers/${created2.body.data.id}`)
      .set(bearer(stranger.accessToken));
    expect(denied.status).toBe(403);
  });

  it('rejects more than the 5-image gallery limit', async () => {
    const trader = await registerApprovedTrader(app);
    const keys: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const { storageKey } = await seedStorageObject(
        storage,
        StoragePrefix.poultryOfferImages,
        Buffer.alloc(10, 1),
        'image/png',
      );
      keys.push(storageKey);
    }
    const res = await createOffer(trader.accessToken, { galleryKeys: keys });
    expect(res.status).toBe(422);
  });

  it('rejects a storage key stolen from a different prefix (409 STORAGE_KEY_MISMATCH)', async () => {
    const trader = await registerApprovedTrader(app);
    const stolen = await seedStorageObject(
      storage,
      'content/books',
      Buffer.alloc(10, 1),
      'image/png',
    );
    const res = await createOffer(trader.accessToken, { galleryKeys: [stolen.storageKey] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STORAGE_KEY_MISMATCH');
  });

  it('rejects a gallery key that was never actually uploaded (400 STORAGE_OBJECT_MISSING)', async () => {
    const trader = await registerApprovedTrader(app);
    const res = await createOffer(trader.accessToken, {
      galleryKeys: [`${StoragePrefix.poultryOfferImages}/2026/09/never-uploaded.png`],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STORAGE_OBJECT_MISSING');
  });

  it('POST /poultry-offers/upload-url issues a key under market/poultry-offers/', async () => {
    const trader = await registerApprovedTrader(app);
    const res = await request(app)
      .post('/api/v1/poultry-offers/upload-url')
      .set(bearer(trader.accessToken))
      .send({ filename: 'flock.png', mimeType: 'image/png', size: 1024 });
    expect(res.status).toBe(201);
    expect(res.body.data.storageKey.startsWith(`${StoragePrefix.poultryOfferImages}/`)).toBe(true);
  });

  it('/poultry-offers/mine requires an approved trader and lists only my offers', async () => {
    const trader = await registerApprovedTrader(app);
    const other = await registerApprovedTrader(app);
    await createOffer(trader.accessToken);
    await createOffer(other.accessToken);

    const mine = await request(app)
      .get('/api/v1/poultry-offers/mine')
      .set(bearer(trader.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].traderUserId).toBe(trader.id);
  });

  it('admin listing sees offers regardless of status', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    const created = await createOffer(trader.accessToken);
    await request(app)
      .delete(`/api/v1/poultry-offers/${created.body.data.id}`)
      .set(bearer(trader.accessToken));

    const adminList = await request(app)
      .get('/api/v1/admin/poultry-offers?status=REMOVED')
      .set(bearer(admin.accessToken));
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.some((o: { id: string }) => o.id === created.body.data.id)).toBe(
      true,
    );
  });
});
