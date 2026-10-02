import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  approveTraderAsAdmin,
  bearer,
  registerAdmin,
  registerApprovedTrader,
  registerUser,
  submitTraderRegistration,
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

async function expire(userId: string): Promise<void> {
  await getTestDb()('trader_profiles').where({ user_id: userId }).update({
    subscription_start_date: '2025-01-01',
    subscription_end_date: '2025-12-31',
  });
}

/** Final corrections §8 — traders have a limited activation period. */
describe('poultry trader activation period', () => {
  it('approval starts a one-year period by default (or the admin-chosen dates)', async () => {
    const admin = await registerAdmin(app);
    const a = await registerUser(app);
    await submitTraderRegistration(app, a.accessToken);
    const approved = await approveTraderAsAdmin(app, admin.accessToken, a.id);
    expect(approved.status).toBe(200);
    expect(approved.body.data.subscriptionStatus).toBe('ACTIVE');
    expect(approved.body.data.subscriptionEndDate).toBeTruthy();

    const b = await registerUser(app);
    await submitTraderRegistration(app, b.accessToken);
    const chosen = await request(app)
      .post(`/api/v1/admin/traders/${b.id}/approve`)
      .set(bearer(admin.accessToken))
      .send({ subscription: { startDate: '2026-01-01', endDate: '2999-01-01' } });
    expect(chosen.body.data.subscriptionEndDate).toBe('2999-01-01');
  });

  it('an expired trader is blocked from trader-only market access and their ads leave the public market', async () => {
    const trader = await registerApprovedTrader(app);
    const viewer = await registerUser(app);
    const admin = await registerAdmin(app);
    const created = await request(app)
      .post('/api/v1/poultry-offers')
      .set(bearer(trader.accessToken))
      .send(offerBody);
    expect(created.status).toBe(201);
    await request(app)
      .post(`/api/v1/admin/poultry-offers/${created.body.data.id}/approve`)
      .set(bearer(admin.accessToken));

    const visible = await request(app)
      .get('/api/v1/poultry-offers')
      .set(bearer(viewer.accessToken));
    expect(visible.body.data).toHaveLength(1);

    await expire(trader.id);

    const blocked = await request(app)
      .post('/api/v1/poultry-offers')
      .set(bearer(trader.accessToken))
      .send(offerBody);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('TRADER_SUBSCRIPTION_EXPIRED');
    const mine = await request(app).get('/api/v1/egg-offers/mine').set(bearer(trader.accessToken));
    expect(mine.status).toBe(403);
    const stats = await request(app)
      .get('/api/v1/poultry-market/statistics')
      .set(bearer(trader.accessToken));
    expect(stats.status).toBe(403);

    const hidden = await request(app).get('/api/v1/poultry-offers').set(bearer(viewer.accessToken));
    expect(hidden.body.data).toHaveLength(0);
  });

  it('the trader requests a renewal (only once expired); the admin renews; access returns', async () => {
    const trader = await registerApprovedTrader(app);
    const admin = await registerAdmin(app);

    const early = await request(app)
      .post('/api/v1/traders/me/renewal-request')
      .set(bearer(trader.accessToken));
    expect(early.status).toBe(409);

    await expire(trader.id);
    const asked = await request(app)
      .post('/api/v1/traders/me/renewal-request')
      .set(bearer(trader.accessToken));
    expect(asked.status).toBe(201);
    expect(asked.body.data.renewalRequestedAt).toBeTruthy();
    expect(
      (
        await request(app)
          .post('/api/v1/traders/me/renewal-request')
          .set(bearer(trader.accessToken))
      ).status,
    ).toBe(409);

    const dash = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(admin.accessToken));
    const card = dash.body.data.cards.find((c: { id: string }) => c.id === 'poultryMarket');
    expect(card.sectionCounts.traders).toBe(1);

    const renewed = await request(app)
      .put(`/api/v1/admin/traders/${trader.id}/subscription`)
      .set(bearer(admin.accessToken))
      .send({ startDate: '2026-01-01', endDate: '2999-12-31' });
    expect(renewed.status).toBe(200);
    expect(renewed.body.data.subscriptionStatus).toBe('ACTIVE');
    expect(renewed.body.data.renewalRequestedAt).toBeNull();

    const back = await request(app)
      .post('/api/v1/poultry-offers')
      .set(bearer(trader.accessToken))
      .send(offerBody);
    expect(back.status).toBe(201);

    const status = await request(app).get('/api/v1/traders/me').set(bearer(trader.accessToken));
    expect(status.body.data.profile.subscriptionStatus).toBe('ACTIVE');
  });

  it('only an admin with trader.admin.approve can set the period', async () => {
    const trader = await registerApprovedTrader(app);
    const other = await registerUser(app);
    const res = await request(app)
      .put(`/api/v1/admin/traders/${trader.id}/subscription`)
      .set(bearer(other.accessToken))
      .send({ startDate: '2026-01-01', endDate: '2027-01-01' });
    expect(res.status).toBe(403);
  });
});
