import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createFarm,
  createSheepBatch,
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
  const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Sheep Ops Farm' });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: vet.id, role: 'VETERINARIAN' });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: staff.id, role: 'STAFF' });
  const batch = await createSheepBatch(app, vet.accessToken, farm.id, {
    headCount: 150,
    arrivalDate: '2026-02-01',
  });
  return { admin, owner, vet, staff, farm, batch };
}

const daily = (orgId: string, batchId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/sheep/batches/${batchId}/daily-records${id ? `/${id}` : ''}`;
const health = (orgId: string, batchId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/sheep/batches/${batchId}/health-events${id ? `/${id}` : ''}`;
const cases = (orgId: string, batchId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/sheep/batches/${batchId}/cases${id ? `/${id}` : ''}`;

describe('sheep daily records', () => {
  it('a vet creates, lists, updates and deletes a daily record — including the new sick-cases/feed-type fields', async () => {
    const { vet, farm, batch } = await setup();

    const create = await request(app)
      .post(daily(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({
        recordDate: '2026-02-02',
        feedKg: 85,
        waterLiters: 300,
        appetite: 'GOOD',
        activity: 'ACTIVE',
        mortalityCount: 0,
        sickCasesCount: 2,
        feedType: 'CONCENTRATED',
        treatment: null,
        expenseAmount: 75000,
        averageWeightKg: 230,
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({
      sheepBatchId: batch.id,
      recordDate: '2026-02-02',
      feedKg: '85.00',
      sickCasesCount: 2,
      feedType: 'CONCENTRATED',
    });

    const list = await request(app).get(daily(farm.id, batch.id)).set(bearer(vet.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(daily(farm.id, batch.id, id))
      .set(bearer(vet.accessToken))
      .send({ sickCasesCount: 3, feedType: 'MIXED' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.sickCasesCount).toBe(3);
    expect(upd.body.data.feedType).toBe('MIXED');

    const del = await request(app).delete(daily(farm.id, batch.id, id)).set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
  });

  it('rejects a second record for the same date (409)', async () => {
    const { vet, farm, batch } = await setup();
    const body = { recordDate: '2026-02-03', feedKg: 10 };
    await request(app).post(daily(farm.id, batch.id)).set(bearer(vet.accessToken)).send(body);
    const dup = await request(app).post(daily(farm.id, batch.id)).set(bearer(vet.accessToken)).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SHEEP_DAILY_RECORD_DUPLICATE_DATE');
  });

  it('rejects a future record date (422)', async () => {
    const { vet, farm, batch } = await setup();
    const res = await request(app)
      .post(daily(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({ recordDate: '2999-01-01' });
    expect(res.status).toBe(422);
  });

  it('STAFF can read but not write daily records', async () => {
    const { vet, staff, farm, batch } = await setup();
    await request(app)
      .post(daily(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({ recordDate: '2026-02-02', feedKg: 5 });

    const read = await request(app).get(daily(farm.id, batch.id)).set(bearer(staff.accessToken));
    expect(read.status).toBe(200);
    const write = await request(app)
      .post(daily(farm.id, batch.id))
      .set(bearer(staff.accessToken))
      .send({ recordDate: '2026-02-04', feedKg: 5 });
    expect(write.status).toBe(403);
  });

  it('a non-member is denied (403)', async () => {
    const { farm, batch } = await setup();
    const stranger = await registerUser(app);
    const res = await request(app).get(daily(farm.id, batch.id)).set(bearer(stranger.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('sheep batch summary + weekly summary (server-computed)', () => {
  it('derives current count, mortality and estimated profit from the records', async () => {
    const { vet, farm, batch } = await setup();
    await request(app)
      .patch(`/api/v1/organizations/${farm.id}/sheep/batches/${batch.id}`)
      .set(bearer(vet.accessToken))
      .send({ targetPricePerKg: 3, averageWeightKg: 40, initialHeadCount: 150 });

    for (const [d, m] of [
      ['2026-02-02', 3],
      ['2026-02-03', 2],
    ] as const) {
      await request(app).post(daily(farm.id, batch.id)).set(bearer(vet.accessToken)).send({
        recordDate: d,
        mortalityCount: m,
        feedKg: 85,
        waterLiters: 300,
        expenseAmount: 50000,
      });
    }

    const summary = await request(app)
      .get(`/api/v1/organizations/${farm.id}/sheep/batches/${batch.id}/summary`)
      .set(bearer(vet.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      initialHeadCount: 150,
      totalMortality: 5,
      currentHeadCount: 145,
      recordsCount: 2,
    });
    // revenue 145 * 40kg * 3 = 17400 ; expenses 100000 ; profit negative
    expect(summary.body.data.estimatedProfit).toBe(17400 - 100000);
    expect(summary.body.data.totalExpenses).toBe(100000);
  });

  it('weekly summary aggregates the anchored week', async () => {
    const { vet, farm, batch } = await setup();
    // 2026-02-02 is a Monday
    for (const [d, feed] of [
      ['2026-02-02', 80],
      ['2026-02-03', 85],
      ['2026-02-04', 90],
    ] as const) {
      await request(app)
        .post(daily(farm.id, batch.id))
        .set(bearer(vet.accessToken))
        .send({ recordDate: d, feedKg: feed, waterLiters: 300, mortalityCount: 1 });
    }
    const res = await request(app)
      .get(`/api/v1/organizations/${farm.id}/sheep/batches/${batch.id}/weekly-summary?weekOf=2026-02-04`)
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      weekStart: '2026-02-02',
      weekEnd: '2026-02-08',
      recordsCount: 3,
      totalFeedKg: 255,
      totalMortality: 3,
    });
  });
});

describe('sheep health events (treatments & vaccinations)', () => {
  it('a vet creates, lists, updates and deletes a health event', async () => {
    const { vet, farm, batch } = await setup();
    const create = await request(app)
      .post(health(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({
        kind: 'VACCINATION',
        name: 'لقاح الحمى القلاعية',
        eventDate: '2026-02-05',
        coverageCount: 150,
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({ kind: 'VACCINATION', coverageCount: 150 });

    const list = await request(app).get(health(farm.id, batch.id)).set(bearer(vet.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const upd = await request(app)
      .patch(health(farm.id, batch.id, id))
      .set(bearer(vet.accessToken))
      .send({ status: 'DONE' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe('DONE');

    const del = await request(app).delete(health(farm.id, batch.id, id)).set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
  });

  it('STAFF can read but not write health events', async () => {
    const { vet, staff, farm, batch } = await setup();
    await request(app)
      .post(health(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({ kind: 'TREATMENT', name: 'مضاد حيوي', eventDate: '2026-02-05' });
    const read = await request(app).get(health(farm.id, batch.id)).set(bearer(staff.accessToken));
    expect(read.status).toBe(200);
    const write = await request(app)
      .post(health(farm.id, batch.id))
      .set(bearer(staff.accessToken))
      .send({ kind: 'TREATMENT', name: 'x', eventDate: '2026-02-05' });
    expect(write.status).toBe(403);
  });
});

describe('sheep individual cases', () => {
  it('a vet creates, lists, updates and deletes a case, and reads the case summary', async () => {
    const { vet, farm, batch } = await setup();
    const create = await request(app)
      .post(cases(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({
        sex: 'FEMALE',
        diagnosis: 'كسر في القائمة',
        treatment: 'جبيرة',
        startedOn: '2026-02-06',
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({ sex: 'FEMALE', status: 'UNDER_TREATMENT' });

    const list = await request(app).get(cases(farm.id, batch.id)).set(bearer(vet.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const upd = await request(app)
      .patch(cases(farm.id, batch.id, id))
      .set(bearer(vet.accessToken))
      .send({ status: 'RECOVERED' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe('RECOVERED');

    const summary = await request(app)
      .get(`${cases(farm.id, batch.id)}/summary`)
      .set(bearer(vet.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({ recovered: 1, underTreatment: 0, deceased: 0 });

    const del = await request(app).delete(cases(farm.id, batch.id, id)).set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
  });

  it('STAFF can read but not write cases', async () => {
    const { vet, staff, farm, batch } = await setup();
    await request(app)
      .post(cases(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({ startedOn: '2026-02-06' });
    const read = await request(app).get(cases(farm.id, batch.id)).set(bearer(staff.accessToken));
    expect(read.status).toBe(200);
    const write = await request(app)
      .post(cases(farm.id, batch.id))
      .set(bearer(staff.accessToken))
      .send({ startedOn: '2026-02-06' });
    expect(write.status).toBe(403);
  });
});
