import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
  createOrganization,
  createSheepFarm,
  joinFarm,
  registerAdmin,
  registerApprovedTrader,
  registerApprovedVet,
  registerUser,
  setFarmSubscriptionAsAdmin,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const offerBody = {
  birdType: 'BROILER',
  quantity: 2000,
  pricingMethod: 'PER_KG',
  price: '3000',
  governorate: 'نينوى',
  phone: '+9647701234567',
};

const EXPIRED = { startDate: '2025-01-01', endDate: '2025-12-31' };
const ACTIVE = { startDate: '2026-01-01', endDate: '2099-01-01' };

async function access(token: string) {
  const res = await request(app).get('/api/v1/poultry-market/access').set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data as {
    hasAccess: boolean;
    merchant: { reason: string; eligible: boolean };
    farms: Array<{ organizationId: string; reason: string; eligible: boolean }>;
    sections: { markets: boolean; sell: boolean; poultryFarm: boolean };
  };
}

/** Every protected market read, called directly (no app UI involved). */
async function marketReads(token: string): Promise<number[]> {
  const paths = [
    '/api/v1/poultry-offers',
    '/api/v1/egg-offers',
    '/api/v1/poultry-market/exchange-rates/poultry?date=2026-09-03',
    '/api/v1/poultry-market/exchange-rates/egg?date=2026-09-03',
    '/api/v1/poultry-market/statistics',
  ];
  return Promise.all(paths.map(async (p) => (await request(app).get(p).set(bearer(token))).status));
}

async function expireTrader(userId: string): Promise<void> {
  await getTestDb()('trader_profiles').where({ user_id: userId }).update({
    subscription_start_date: EXPIRED.startDate,
    subscription_end_date: EXPIRED.endDate,
  });
}

describe('Markets & Exchanges access (merchant / poultry farm accounts)', () => {
  it('a user with neither account sees the registration state and is refused by every market API', async () => {
    const u = await registerUser(app);
    const a = await access(u.accessToken);
    expect(a.hasAccess).toBe(false);
    expect(a.merchant.reason).toBe('NOT_REGISTERED');
    expect(a.farms).toEqual([]);
    expect(a.sections).toEqual({ markets: false, sell: false, poultryFarm: false });

    expect(await marketReads(u.accessToken)).toEqual([403, 403, 403, 403, 403]);
    const res = await request(app).get('/api/v1/poultry-offers').set(bearer(u.accessToken));
    expect(res.body.error.code).toBe('MARKET_ACCOUNT_REQUIRED');
    const create = await request(app)
      .post('/api/v1/poultry-offers')
      .set(bearer(u.accessToken))
      .send(offerBody);
    expect(create.status).toBe(403);
  });

  it('an eligible merchant gets the markets but no poultry farm card', async () => {
    const trader = await registerApprovedTrader(app);
    const a = await access(trader.accessToken);
    expect(a.merchant.reason).toBe('ELIGIBLE');
    expect(a.sections).toEqual({ markets: true, sell: true, poultryFarm: false });
    expect(await marketReads(trader.accessToken)).toEqual([200, 200, 200, 200, 200]);
  });

  it('the owner of an active poultry farm gets the markets, can sell, and gets the farm card', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const a = await access(owner.accessToken);
    expect(a.merchant.reason).toBe('NOT_REGISTERED');
    expect(a.farms).toHaveLength(1);
    expect(a.farms[0]).toMatchObject({ organizationId: farm.id, reason: 'ELIGIBLE' });
    expect(a.sections).toEqual({ markets: true, sell: true, poultryFarm: true });
    expect(await marketReads(owner.accessToken)).toEqual([200, 200, 200, 200, 200]);

    const created = await request(app)
      .post('/api/v1/poultry-offers')
      .set(bearer(owner.accessToken))
      .send(offerBody);
    expect(created.status).toBe(201);
  });

  it('a pending farm, a sheep farm, or mere farm membership never grants access', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const pending = await createOrganization(app, owner.accessToken, {
      type: 'FARM',
      name: 'Pending farm',
    });
    const a = await access(owner.accessToken);
    expect(a.farms.find((f) => f.organizationId === pending.id)?.reason).toBe('PENDING_APPROVAL');
    expect(a.hasAccess).toBe(false);

    const sheepOwner = await registerUser(app);
    const sheep = await createSheepFarm(app, sheepOwner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, sheep.id, ACTIVE);
    expect((await access(sheepOwner.accessToken)).farms).toEqual([]);
    expect(await marketReads(sheepOwner.accessToken)).toEqual([403, 403, 403, 403, 403]);

    // A veterinarian who JOINED someone else's active farm is not its owner.
    const farmOwner = await registerUser(app);
    const farm = await createFarm(app, farmOwner.accessToken, admin.accessToken);
    const vet = await registerApprovedVet(app);
    expect((await joinFarm(app, vet.accessToken, farm.joinCode)).status).toBe(201);
    const v = await access(vet.accessToken);
    expect(v.hasAccess).toBe(false);
    expect(
      (await request(app).get('/api/v1/poultry-offers').set(bearer(vet.accessToken))).status,
    ).toBe(403);
  });

  it('an expired farm is refused (direct API calls too) until renewed; renewal restores access and its ads', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const viewer = await registerApprovedTrader(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const created = await request(app)
      .post('/api/v1/poultry-offers')
      .set(bearer(owner.accessToken))
      .send(offerBody);
    await request(app)
      .post(`/api/v1/admin/poultry-offers/${created.body.data.id}/approve`)
      .set(bearer(admin.accessToken));
    const listed = async () =>
      (await request(app).get('/api/v1/poultry-offers').set(bearer(viewer.accessToken))).body
        .data as unknown[];
    expect(await listed()).toHaveLength(1);

    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, EXPIRED);
    const a = await access(owner.accessToken);
    expect(a.farms[0]?.reason).toBe('SUBSCRIPTION_EXPIRED');
    expect(a.sections).toEqual({ markets: false, sell: false, poultryFarm: false });
    expect(await marketReads(owner.accessToken)).toEqual([403, 403, 403, 403, 403]);
    const denied = await request(app).get('/api/v1/egg-offers').set(bearer(owner.accessToken));
    expect(denied.body.error.code).toBe('FARM_SUBSCRIPTION_NOT_ACTIVE');
    const sell = await request(app)
      .post('/api/v1/egg-offers/upload-url')
      .set(bearer(owner.accessToken))
      .send({ filename: 'a.jpg', mimeType: 'image/jpeg', size: 100 });
    expect(sell.status).toBe(403);
    // Their ads leave the public market while the farm is expired.
    expect(await listed()).toHaveLength(0);

    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, ACTIVE);
    expect((await access(owner.accessToken)).sections.markets).toBe(true);
    expect(await marketReads(owner.accessToken)).toEqual([200, 200, 200, 200, 200]);
    expect(await listed()).toHaveLength(1);
  });

  it('both accounts are evaluated independently — an expired one never blocks (or grants through) the other', async () => {
    const admin = await registerAdmin(app);
    const both = await registerApprovedTrader(app);
    const farm = await createFarm(app, both.accessToken, admin.accessToken);

    const full = await access(both.accessToken);
    expect(full.sections).toEqual({ markets: true, sell: true, poultryFarm: true });
    // One farm card, one merchant record — no duplicates.
    expect(full.farms).toHaveLength(1);

    // Merchant expired, farm active → access through the farm only.
    await expireTrader(both.id);
    const viaFarm = await access(both.accessToken);
    expect(viaFarm.merchant.reason).toBe('SUBSCRIPTION_EXPIRED');
    expect(viaFarm.sections).toEqual({ markets: true, sell: true, poultryFarm: true });
    expect(await marketReads(both.accessToken)).toEqual([200, 200, 200, 200, 200]);

    // Farm expired too → nothing left.
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, EXPIRED);
    const none = await access(both.accessToken);
    expect(none.hasAccess).toBe(false);
    const res = await request(app).get('/api/v1/poultry-offers').set(bearer(both.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TRADER_SUBSCRIPTION_EXPIRED');

    // Merchant renewed, farm still expired → markets, but no poultry farm card.
    await request(app)
      .put(`/api/v1/admin/traders/${both.id}/subscription`)
      .set(bearer(admin.accessToken))
      .send(ACTIVE)
      .expect(200);
    const viaMerchant = await access(both.accessToken);
    expect(viaMerchant.merchant.reason).toBe('ELIGIBLE');
    expect(viaMerchant.farms[0]?.reason).toBe('SUBSCRIPTION_EXPIRED');
    expect(viaMerchant.sections).toEqual({ markets: true, sell: true, poultryFarm: false });
  });

  it('admins browse without any account (oversight) but cannot sell without one', async () => {
    const admin = await registerAdmin(app);
    const a = await access(admin.accessToken);
    expect(a.sections).toEqual({ markets: true, sell: false, poultryFarm: false });
    expect(await marketReads(admin.accessToken)).toEqual([200, 200, 200, 200, 200]);
  });
});
