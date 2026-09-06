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
    .post('/api/v1/egg-offers')
    .set(bearer(token))
    .send({
      eggType: 'WHITE',
      sellUnit: 'TRAY_30',
      quantity: 3000,
      pricePerUnit: '5000',
      governorate: 'نينوى',
      phone: '+9647701234567',
      ...overrides,
    });
}

describe('egg market offers', () => {
  it('create requires an approved trader (403 TRADER_APPROVAL_REQUIRED)', async () => {
    const u = await registerUser(app);
    const res = await createOffer(u.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TRADER_APPROVAL_REQUIRED');
  });

  it('create by an approved trader is immediately ACTIVE — no moderation step', async () => {
    const trader = await registerApprovedTrader(app);
    const res = await createOffer(trader.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.traderUserId).toBe(trader.id);

    const list = await request(app).get('/api/v1/egg-offers').set(bearer(trader.accessToken));
    expect(list.body.data.some((o: { id: string }) => o.id === res.body.data.id)).toBe(true);
  });

  it('filters by eggType and governorate', async () => {
    const trader = await registerApprovedTrader(app);
    await createOffer(trader.accessToken, { eggType: 'WHITE', governorate: 'نينوى' });
    await createOffer(trader.accessToken, { eggType: 'BROWN', governorate: 'بغداد' });

    const byType = await request(app)
      .get('/api/v1/egg-offers?eggType=BROWN')
      .set(bearer(trader.accessToken));
    expect(byType.body.data).toHaveLength(1);
    expect(byType.body.data[0].eggType).toBe('BROWN');
  });

  it('owner can delete their own offer; a different trader gets 403', async () => {
    const trader = await registerApprovedTrader(app);
    const other = await registerApprovedTrader(app);
    const created = await createOffer(trader.accessToken);
    const offerId = created.body.data.id as string;

    const forbidden = await request(app)
      .delete(`/api/v1/egg-offers/${offerId}`)
      .set(bearer(other.accessToken));
    expect(forbidden.status).toBe(403);

    const removed = await request(app)
      .delete(`/api/v1/egg-offers/${offerId}`)
      .set(bearer(trader.accessToken));
    expect(removed.status).toBe(200);
  });

  it('admin can delete any offer via market.offer.admin.delete', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    const created = await createOffer(trader.accessToken);

    const removed = await request(app)
      .delete(`/api/v1/egg-offers/${created.body.data.id}`)
      .set(bearer(admin.accessToken));
    expect(removed.status).toBe(200);
  });

  it('a MARKET system-supervisor can delete any offer', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);
    const specialist = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, specialist.id, 'MARKET');

    const created = await createOffer(trader.accessToken);
    const removed = await request(app)
      .delete(`/api/v1/egg-offers/${created.body.data.id}`)
      .set(bearer(specialist.accessToken));
    expect(removed.status).toBe(200);
  });

  it('rejects more than the 4-image gallery limit', async () => {
    const trader = await registerApprovedTrader(app);
    const keys: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { storageKey } = await seedStorageObject(
        storage,
        StoragePrefix.eggOfferImages,
        Buffer.alloc(10, 1),
        'image/png',
      );
      keys.push(storageKey);
    }
    const res = await createOffer(trader.accessToken, { galleryKeys: keys });
    expect(res.status).toBe(422);
  });

  it('rejects a gallery key that was never actually uploaded (400 STORAGE_OBJECT_MISSING)', async () => {
    const trader = await registerApprovedTrader(app);
    const res = await createOffer(trader.accessToken, {
      galleryKeys: [`${StoragePrefix.eggOfferImages}/2026/09/never-uploaded.png`],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STORAGE_OBJECT_MISSING');
  });

  it('/egg-offers/mine requires an approved trader and lists only my offers', async () => {
    const trader = await registerApprovedTrader(app);
    const other = await registerApprovedTrader(app);
    await createOffer(trader.accessToken);
    await createOffer(other.accessToken);

    const mine = await request(app).get('/api/v1/egg-offers/mine').set(bearer(trader.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].traderUserId).toBe(trader.id);
  });
});
