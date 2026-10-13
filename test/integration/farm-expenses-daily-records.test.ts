import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
  createPoultryFlock,
  createSheepBatch,
  createSheepFarm,
  registerAdmin,
  registerApprovedVet,
  seedDailyRecordRow,
} from '../helpers/factories.js';
import { businessToday } from '../../src/shared/time/business-date.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const expenses = (orgId: string, suffix = ''): string =>
  `/api/v1/organizations/${orgId}/farm/expenses${suffix}`;
const dailyRecords = (orgId: string, flockId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/poultry/flocks/${flockId}/daily-records${id ? `/${id}` : ''}`;

interface ExpenseItem {
  id: string;
  amount: string;
  category: string;
  spentOn: string;
  source: 'MANUAL' | 'DAILY_RECORD';
  dailyRecord: { recordId: string; batchKind: string; batchId: string; batchName: string } | null;
}

async function setup() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const farm = await createFarm(app, owner.accessToken, admin.accessToken);
  const flock = await createPoultryFlock(app, owner.accessToken, farm.id, {
    name: 'Batch A',
    birdCount: 1000,
  });
  return { admin, owner, farm, flock };
}

async function list(token: string, orgId: string, query = ''): Promise<ExpenseItem[]> {
  const res = await request(app).get(expenses(orgId, query)).set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data as ExpenseItem[];
}

describe('farm expenses include daily-record expenses', () => {
  it('a daily record expense appears once in the Expenses list and totals, next to manual expenses', async () => {
    const { owner, farm, flock } = await setup();

    const daily = await request(app)
      .post(dailyRecords(farm.id, flock.id))
      .set(bearer(owner.accessToken))
      .send({ feedKg: 10, waterLiters: 20, mortalityCount: 0, expenseAmount: 850 });
    expect(daily.status).toBe(201);

    const manual = await request(app)
      .post(expenses(farm.id))
      .set(bearer(owner.accessToken))
      .send({ category: 'FEED', amount: 1500, spentOn: businessToday() });
    expect(manual.status).toBe(201);

    const items = await list(owner.accessToken, farm.id);
    expect(items).toHaveLength(2);
    const fromDaily = items.find((i) => i.source === 'DAILY_RECORD');
    expect(fromDaily).toMatchObject({
      id: daily.body.data.id,
      amount: '850.00',
      spentOn: businessToday(),
      dailyRecord: {
        recordId: daily.body.data.id,
        batchKind: 'POULTRY',
        batchId: flock.id,
        batchName: 'Batch A',
      },
    });
    expect(items.find((i) => i.source === 'MANUAL')).toMatchObject({
      id: manual.body.data.id,
      category: 'FEED',
      dailyRecord: null,
    });

    // Totals: 850 + 1500, each counted once.
    const summary = await request(app)
      .get(expenses(farm.id, '/summary'))
      .set(bearer(owner.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.totalThisWeek).toBe(2350);
    expect(summary.body.data.totalThisMonth).toBe(2350);

    // The batch summary is unchanged by the merge: daily + this flock's manual (none here).
    const batch = await request(app)
      .get(`/api/v1/organizations/${farm.id}/poultry/flocks/${flock.id}/summary`)
      .set(bearer(owner.accessToken));
    expect(batch.body.data.totalExpenses).toBe(850);
  });

  it('editing or deleting the daily record updates the Expenses list (no stale copy)', async () => {
    const { owner, farm, flock } = await setup();
    const daily = await request(app)
      .post(dailyRecords(farm.id, flock.id))
      .set(bearer(owner.accessToken))
      .send({ feedKg: 1, waterLiters: 1, expenseAmount: 300 });
    const recordId = daily.body.data.id as string;

    await request(app)
      .patch(dailyRecords(farm.id, flock.id, recordId))
      .set(bearer(owner.accessToken))
      .send({ expenseAmount: 450 });
    expect((await list(owner.accessToken, farm.id))[0]).toMatchObject({ amount: '450.00' });

    // An expense of 0 is not an expense line.
    await request(app)
      .patch(dailyRecords(farm.id, flock.id, recordId))
      .set(bearer(owner.accessToken))
      .send({ expenseAmount: 0 });
    expect(await list(owner.accessToken, farm.id)).toHaveLength(0);

    await request(app)
      .patch(dailyRecords(farm.id, flock.id, recordId))
      .set(bearer(owner.accessToken))
      .send({ expenseAmount: 200 });
    await request(app)
      .delete(dailyRecords(farm.id, flock.id, recordId))
      .set(bearer(owner.accessToken));
    expect(await list(owner.accessToken, farm.id)).toHaveLength(0);
  });

  it('a category filter lists manual expenses only; pagination and newest-first span both sources', async () => {
    const { owner, farm, flock } = await setup();
    await seedDailyRecordRow('poultry', flock.id, farm.id, '2026-03-01', { expenseAmount: 100 });
    await seedDailyRecordRow('poultry', flock.id, farm.id, '2026-03-03', { expenseAmount: 300 });
    await request(app)
      .post(expenses(farm.id))
      .set(bearer(owner.accessToken))
      .send({ category: 'MEDICINE', amount: 200, spentOn: '2026-03-02' });

    const all = await list(owner.accessToken, farm.id);
    expect(all.map((i) => i.spentOn)).toEqual(['2026-03-03', '2026-03-02', '2026-03-01']);

    const page2 = await request(app)
      .get(expenses(farm.id, '?page=2&pageSize=2'))
      .set(bearer(owner.accessToken));
    expect(page2.body.meta.total).toBe(3);
    expect(page2.body.data.map((i: ExpenseItem) => i.spentOn)).toEqual(['2026-03-01']);

    const medicine = await list(owner.accessToken, farm.id, '?category=MEDICINE');
    expect(medicine).toHaveLength(1);
    expect(medicine[0]).toMatchObject({ source: 'MANUAL', category: 'MEDICINE' });
  });

  it('a flock filter keeps that flock’s daily records and manual expenses only', async () => {
    const { owner, farm, flock } = await setup();
    const other = await createPoultryFlock(app, owner.accessToken, farm.id, { birdCount: 50 });
    await seedDailyRecordRow('poultry', flock.id, farm.id, '2026-03-01', { expenseAmount: 100 });
    await seedDailyRecordRow('poultry', other.id, farm.id, '2026-03-01', { expenseAmount: 999 });

    const items = await list(owner.accessToken, farm.id, `?poultryFlockId=${flock.id}`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amount: '100.00' });
  });

  it('sheep daily-record expenses appear in the sheep farm’s Expenses list', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createSheepFarm(app, owner.accessToken, admin.accessToken);
    const batch = await createSheepBatch(app, owner.accessToken, farm.id, { name: 'Flock S' });
    await seedDailyRecordRow('sheep', batch.id, farm.id, businessToday(), { expenseAmount: 75 });

    const items = await list(owner.accessToken, farm.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'DAILY_RECORD',
      amount: '75.00',
      dailyRecord: { batchKind: 'SHEEP', batchId: batch.id, batchName: 'Flock S' },
    });
    const summary = await request(app)
      .get(expenses(farm.id, '/summary'))
      .set(bearer(owner.accessToken));
    expect(summary.body.data.totalThisMonth).toBe(75);
  });
});
