import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createFarm,
  createPoultryFlock,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const staff = await registerUser(app);
  const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Ops Farm' });
  await addOrganizationMember(app, owner.accessToken, farm.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: staff.id, role: 'STAFF' });
  const flock = await createPoultryFlock(app, vet.accessToken, farm.id, {
    birdCount: 5000,
    arrivalDate: '2026-02-01',
  });
  return { admin, owner, vet, staff, farm, flock };
}

const daily = (orgId: string, flockId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/poultry/flocks/${flockId}/daily-records${id ? `/${id}` : ''}`;

describe('poultry daily records', () => {
  it('a vet creates, lists, updates and deletes a daily record', async () => {
    const { vet, farm, flock } = await setup();

    const create = await request(app)
      .post(daily(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({
        recordDate: '2026-02-02',
        feedKg: 240,
        waterLiters: 2000,
        appetite: 'GOOD',
        activity: 'ACTIVE',
        mortalityCount: 20,
        mortalityCause: 'cold',
        treatment: 'vitamins',
        expenseAmount: 850,
        averageWeightGrams: 230,
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({
      poultryFlockId: flock.id,
      recordDate: '2026-02-02',
      feedKg: '240.00',
      mortalityCount: 20,
    });

    const list = await request(app).get(daily(farm.id, flock.id)).set(bearer(vet.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(daily(farm.id, flock.id, id))
      .set(bearer(vet.accessToken))
      .send({ mortalityCount: 25 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.mortalityCount).toBe(25);

    const del = await request(app)
      .delete(daily(farm.id, flock.id, id))
      .set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
  });

  it('rejects a second record for the same date (409)', async () => {
    const { vet, farm, flock } = await setup();
    const body = { recordDate: '2026-02-03', feedKg: 10 };
    await request(app).post(daily(farm.id, flock.id)).set(bearer(vet.accessToken)).send(body);
    const dup = await request(app)
      .post(daily(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('POULTRY_DAILY_RECORD_DUPLICATE_DATE');
  });

  it('rejects a future record date (422)', async () => {
    const { vet, farm, flock } = await setup();
    const res = await request(app)
      .post(daily(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({ recordDate: '2999-01-01' });
    expect(res.status).toBe(422);
  });

  it('STAFF can read but not write daily records', async () => {
    const { vet, staff, farm, flock } = await setup();
    await request(app)
      .post(daily(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({ recordDate: '2026-02-02', feedKg: 5 });

    const read = await request(app).get(daily(farm.id, flock.id)).set(bearer(staff.accessToken));
    expect(read.status).toBe(200);
    const write = await request(app)
      .post(daily(farm.id, flock.id))
      .set(bearer(staff.accessToken))
      .send({ recordDate: '2026-02-04', feedKg: 5 });
    expect(write.status).toBe(403);
  });

  it('a non-member is denied (403)', async () => {
    const { farm, flock } = await setup();
    const stranger = await registerUser(app);
    const res = await request(app).get(daily(farm.id, flock.id)).set(bearer(stranger.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('batch summary + weekly summary (server-computed)', () => {
  it('derives current count, mortality and estimated profit from the records', async () => {
    const { vet, farm, flock } = await setup();
    // target price + weight so profit is computable
    await request(app)
      .patch(`/api/v1/organizations/${farm.id}/poultry/flocks/${flock.id}`)
      .set(bearer(vet.accessToken))
      .send({ targetPricePerKg: 3, averageWeightGrams: 2000, initialBirdCount: 5000 });

    for (const [d, m] of [
      ['2026-02-02', 30],
      ['2026-02-03', 20],
    ] as const) {
      await request(app).post(daily(farm.id, flock.id)).set(bearer(vet.accessToken)).send({
        recordDate: d,
        mortalityCount: m,
        feedKg: 100,
        waterLiters: 900,
        expenseAmount: 500,
      });
    }

    const summary = await request(app)
      .get(`/api/v1/organizations/${farm.id}/poultry/flocks/${flock.id}/summary`)
      .set(bearer(vet.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      initialBirdCount: 5000,
      totalMortality: 50,
      currentBirdCount: 4950,
      recordsCount: 2,
    });
    // revenue 4950 * 2kg * 3 = 29700 ; expenses 1000 ; profit 28700
    expect(summary.body.data.estimatedProfit).toBe(28700);
    expect(summary.body.data.totalExpenses).toBe(1000);
  });

  it('weekly summary aggregates the anchored week', async () => {
    const { vet, farm, flock } = await setup();
    // 2026-02-02 is a Monday
    for (const [d, feed] of [
      ['2026-02-02', 100],
      ['2026-02-03', 120],
      ['2026-02-04', 140],
    ] as const) {
      await request(app)
        .post(daily(farm.id, flock.id))
        .set(bearer(vet.accessToken))
        .send({ recordDate: d, feedKg: feed, waterLiters: 1000, mortalityCount: 10 });
    }
    const res = await request(app)
      .get(
        `/api/v1/organizations/${farm.id}/poultry/flocks/${flock.id}/weekly-summary?weekOf=2026-02-04`,
      )
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      weekStart: '2026-02-02',
      weekEnd: '2026-02-08',
      recordsCount: 3,
      totalFeedKg: 360,
      totalMortality: 30,
      averageMortality: 10,
    });
  });
});

describe('farm profile + expenses', () => {
  it('the owner updates the farm profile header and reads it back', async () => {
    const { owner, farm } = await setup();
    const upd = await request(app)
      .patch(`/api/v1/organizations/${farm.id}/farm/profile`)
      .set(bearer(owner.accessToken))
      .send({
        address: 'Babil',
        capacity: 10000,
        establishedOn: '2024-01-01',
        farmCategory: 'BROILER',
      });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({
      address: 'Babil',
      capacity: 10000,
      farmCategory: 'BROILER',
    });

    const get = await request(app)
      .get(`/api/v1/organizations/${farm.id}/farm/profile`)
      .set(bearer(owner.accessToken));
    expect(get.body.data.capacity).toBe(10000);
  });

  it('expenses summary reflects created expenses', async () => {
    const { vet, farm } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/expenses`)
      .set(bearer(vet.accessToken))
      .send({ category: 'FEED', amount: 1000, spentOn: today });
    const summary = await request(app)
      .get(`/api/v1/organizations/${farm.id}/farm/expenses/summary`)
      .set(bearer(vet.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.totalThisMonth).toBe(1000);
  });

  it('rejects poultry-ops on a non-FARM organization (400)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinicRes = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(owner.accessToken))
      .send({ type: 'CLINIC', name: 'Clinic' });
    const clinicId = clinicRes.body.data.id as string;
    await request(app)
      .post(`/api/v1/admin/organizations/${clinicId}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);
    const res = await request(app)
      .get(`/api/v1/organizations/${clinicId}/farm/expenses`)
      .set(bearer(owner.accessToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });
});
