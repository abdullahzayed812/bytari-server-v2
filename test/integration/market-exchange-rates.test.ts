import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { assignSystemSupervisor, bearer, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('poultry exchange-rate board', () => {
  it('admin saves a day of rates; any authenticated user can read them back', async () => {
    const admin = await registerAdmin(app);
    const viewer = await registerUser(app);

    const save = await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(admin.accessToken))
      .send({
        date: '2026-09-03',
        entries: [
          { governorate: 'بغداد', meatPricePerKg: '956', layerPricePerBird: '5000' },
          { governorate: 'نينوى', meatPricePerKg: '666', layerPricePerBird: '6262' },
        ],
      });
    expect(save.status).toBe(200);

    const get = await request(app)
      .get('/api/v1/poultry-market/exchange-rates/poultry?date=2026-09-03')
      .set(bearer(viewer.accessToken));
    expect(get.status).toBe(200);
    expect(get.body.data).toHaveLength(2);
    const baghdad = get.body.data.find((r: { governorate: string }) => r.governorate === 'بغداد');
    expect(baghdad.meatPricePerKg).toBe('956.00');
    expect(baghdad.layerPricePerBird).toBe('5000.00');
  });

  it('a plain user cannot save rates (403); a MARKET system-supervisor can', async () => {
    const admin = await registerAdmin(app);
    const stranger = await registerUser(app);
    const specialist = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, specialist.id, 'MARKET');

    const denied = await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(stranger.accessToken))
      .send({ date: '2026-09-03', entries: [{ governorate: 'بغداد', meatPricePerKg: '900' }] });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(specialist.accessToken))
      .send({ date: '2026-09-03', entries: [{ governorate: 'بغداد', meatPricePerKg: '900' }] });
    expect(allowed.status).toBe(200);
  });

  it('computes UP/DOWN/FLAT trend against the previous saved date', async () => {
    const admin = await registerAdmin(app);
    await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(admin.accessToken))
      .send({
        date: '2026-09-02',
        entries: [
          { governorate: 'بغداد', meatPricePerKg: '900', layerPricePerBird: '5000' },
          { governorate: 'نينوى', meatPricePerKg: '700', layerPricePerBird: '6000' },
          { governorate: 'البصرة', meatPricePerKg: '800', layerPricePerBird: '5500' },
        ],
      });
    await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(admin.accessToken))
      .send({
        date: '2026-09-03',
        entries: [
          { governorate: 'بغداد', meatPricePerKg: '950', layerPricePerBird: '5000' }, // UP, FLAT
          { governorate: 'نينوى', meatPricePerKg: '650', layerPricePerBird: '5900' }, // DOWN, DOWN
          { governorate: 'البصرة', meatPricePerKg: '800', layerPricePerBird: '5500' }, // FLAT, FLAT
        ],
      });

    const get = await request(app)
      .get('/api/v1/poultry-market/exchange-rates/poultry?date=2026-09-03')
      .set(bearer(admin.accessToken));
    const byGov = Object.fromEntries(
      get.body.data.map((r: { governorate: string }) => [r.governorate, r]),
    );
    expect(byGov['بغداد'].meatTrend).toBe('UP');
    expect(byGov['بغداد'].layerTrend).toBe('FLAT');
    expect(byGov['نينوى'].meatTrend).toBe('DOWN');
    expect(byGov['نينوى'].layerTrend).toBe('DOWN');
    expect(byGov['البصرة'].meatTrend).toBe('FLAT');
  });

  it('a governorate with no saved entry for the date is simply absent from the response', async () => {
    const admin = await registerAdmin(app);
    await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(admin.accessToken))
      .send({ date: '2026-09-03', entries: [{ governorate: 'بغداد', meatPricePerKg: '900' }] });

    const get = await request(app)
      .get('/api/v1/poultry-market/exchange-rates/poultry?date=2026-09-03')
      .set(bearer(admin.accessToken));
    expect(get.body.data).toHaveLength(1);
    expect(get.body.data[0].governorate).toBe('بغداد');
  });

  it('re-saving the same (board, governorate, date) upserts rather than duplicating', async () => {
    const admin = await registerAdmin(app);
    await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(admin.accessToken))
      .send({ date: '2026-09-03', entries: [{ governorate: 'بغداد', meatPricePerKg: '900' }] });
    await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(admin.accessToken))
      .send({ date: '2026-09-03', entries: [{ governorate: 'بغداد', meatPricePerKg: '950' }] });

    const get = await request(app)
      .get('/api/v1/poultry-market/exchange-rates/poultry?date=2026-09-03')
      .set(bearer(admin.accessToken));
    expect(get.body.data).toHaveLength(1);
    expect(get.body.data[0].meatPricePerKg).toBe('950.00');
  });
});

describe('egg exchange-rate board', () => {
  it('admin saves egg-tray prices; single-column board, independent of the poultry board', async () => {
    const admin = await registerAdmin(app);
    await request(app)
      .post('/api/v1/poultry-market/exchange-rates/egg')
      .set(bearer(admin.accessToken))
      .send({
        date: '2026-09-03',
        entries: [{ governorate: 'بغداد', eggPricePerTray: '5000' }],
      });
    await request(app)
      .post('/api/v1/poultry-market/exchange-rates/poultry')
      .set(bearer(admin.accessToken))
      .send({ date: '2026-09-03', entries: [{ governorate: 'بغداد', meatPricePerKg: '900' }] });

    const eggGet = await request(app)
      .get('/api/v1/poultry-market/exchange-rates/egg?date=2026-09-03')
      .set(bearer(admin.accessToken));
    expect(eggGet.body.data).toHaveLength(1);
    expect(eggGet.body.data[0].eggPricePerTray).toBe('5000.00');

    const poultryGet = await request(app)
      .get('/api/v1/poultry-market/exchange-rates/poultry?date=2026-09-03')
      .set(bearer(admin.accessToken));
    expect(poultryGet.body.data).toHaveLength(1);
    expect(poultryGet.body.data[0].meatPricePerKg).toBe('900.00');
  });
});
