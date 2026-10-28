import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createCattleBatch,
  createCattleFarm,
  createFarm,
  createPoultryFlock,
  createSheepBatch,
  createSheepFarm,
  registerAdmin,
  registerApprovedVet,
  seedDailyRecordRow,
} from '../helpers/factories.js';
import { businessToday } from '../../src/shared/time/business-date.js';

const { app, container } = buildTestApp();

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
  poultryFlockId: string | null;
  sheepBatchId: string | null;
  cattleBatchId: string | null;
  batch: { kind: string; id: string; name: string } | null;
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

describe('farm expenses: manual cards + daily-record amounts in the totals', () => {
  it('a daily record expense is not an expense card; its amount is in the summary totals', async () => {
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
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: manual.body.data.id,
      category: 'FEED',
      amount: '1500.00',
      batch: null,
    });

    // Totals: 850 + 1500, each counted once; the daily share is shown on its own.
    const summary = await request(app)
      .get(expenses(farm.id, '/summary'))
      .set(bearer(owner.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      totalThisWeek: 2350,
      totalThisMonth: 2350,
      dailyRecordsTotal: 850,
      manualTotal: 1500,
      overallTotal: 2350,
    });

    // The batch summary: daily + this flock's manual (none here).
    const batch = await request(app)
      .get(`/api/v1/organizations/${farm.id}/poultry/flocks/${flock.id}/summary`)
      .set(bearer(owner.accessToken));
    expect(batch.body.data.totalExpenses).toBe(850);
  });

  it('editing or deleting the daily record updates the totals (no stale copy)', async () => {
    const { owner, farm, flock } = await setup();
    const daily = await request(app)
      .post(dailyRecords(farm.id, flock.id))
      .set(bearer(owner.accessToken))
      .send({ feedKg: 1, waterLiters: 1, expenseAmount: 300 });
    const recordId = daily.body.data.id as string;
    const dailyTotal = async () =>
      (await request(app).get(expenses(farm.id, '/summary')).set(bearer(owner.accessToken))).body
        .data.dailyRecordsTotal as number;

    await request(app)
      .patch(dailyRecords(farm.id, flock.id, recordId))
      .set(bearer(owner.accessToken))
      .send({ expenseAmount: 450 });
    expect(await dailyTotal()).toBe(450);

    await request(app)
      .delete(dailyRecords(farm.id, flock.id, recordId))
      .set(bearer(owner.accessToken));
    expect(await dailyTotal()).toBe(0);
    expect(await list(owner.accessToken, farm.id)).toHaveLength(0);
  });

  it('newly added expenses are listed first, whatever date they were spent on', async () => {
    const { owner, farm, flock } = await setup();
    await seedDailyRecordRow('poultry', flock.id, farm.id, '2026-03-05', { expenseAmount: 100 });
    const ids: string[] = [];
    for (const spentOn of ['2026-03-03', '2026-03-01', '2026-03-02']) {
      const res = await request(app)
        .post(expenses(farm.id))
        .set(bearer(owner.accessToken))
        .send({ category: 'MEDICINE', amount: 200, spentOn })
        .expect(201);
      ids.push(res.body.data.id as string);
    }

    const all = await list(owner.accessToken, farm.id);
    expect(all.map((i) => i.id)).toEqual([...ids].reverse());

    const page2 = await request(app)
      .get(expenses(farm.id, '?page=2&pageSize=2'))
      .set(bearer(owner.accessToken));
    expect(page2.body.meta.total).toBe(3);
    expect(page2.body.data.map((i: ExpenseItem) => i.id)).toEqual([ids[0]]);

    expect(await list(owner.accessToken, farm.id, '?category=FEED')).toHaveLength(0);
  });

  it('an expense can be linked to one active batch of this farm only', async () => {
    const { admin, owner, farm, flock } = await setup();
    const linked = await request(app)
      .post(expenses(farm.id))
      .set(bearer(owner.accessToken))
      .send({ category: 'FEED', amount: 10, spentOn: businessToday(), poultryFlockId: flock.id });
    expect(linked.status).toBe(201);
    expect(linked.body.data).toMatchObject({
      poultryFlockId: flock.id,
      batch: { kind: 'POULTRY', id: flock.id, name: 'Batch A' },
    });
    const filtered = await list(owner.accessToken, farm.id, `?poultryFlockId=${flock.id}`);
    expect(filtered.map((i) => i.id)).toEqual([linked.body.data.id]);

    // Another farm's batch is rejected.
    const otherOwner = await registerApprovedVet(app);
    const otherFarm = await createFarm(app, otherOwner.accessToken, admin.accessToken);
    const foreign = await createPoultryFlock(app, otherOwner.accessToken, otherFarm.id, {
      birdCount: 10,
    });
    const rejected = await request(app)
      .post(expenses(farm.id))
      .set(bearer(owner.accessToken))
      .send({ category: 'FEED', amount: 10, spentOn: businessToday(), poultryFlockId: foreign.id });
    expect(rejected.status).toBe(422);

    // Two links at once are rejected.
    const sheepFarm = await createSheepFarm(app, owner.accessToken, admin.accessToken);
    const sheep = await createSheepBatch(app, owner.accessToken, sheepFarm.id, { name: 'S' });
    const both = await request(app).post(expenses(farm.id)).set(bearer(owner.accessToken)).send({
      category: 'FEED',
      amount: 10,
      spentOn: businessToday(),
      poultryFlockId: flock.id,
      sheepBatchId: sheep.id,
    });
    expect(both.status).toBe(422);

    // Re-linking through PATCH clears the previous link; null makes it farm-wide.
    const unlinked = await request(app)
      .patch(expenses(farm.id, `/${linked.body.data.id}`))
      .set(bearer(owner.accessToken))
      .send({ poultryFlockId: null });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.data).toMatchObject({ poultryFlockId: null, batch: null });
  });

  it('a sheep batch’s daily-record expenses reach the sheep farm’s totals; manual expenses link to the sheep batch', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createSheepFarm(app, owner.accessToken, admin.accessToken);
    const batch = await createSheepBatch(app, owner.accessToken, farm.id, { name: 'Flock S' });
    await seedDailyRecordRow('sheep', batch.id, farm.id, businessToday(), { expenseAmount: 75 });
    const manual = await request(app)
      .post(expenses(farm.id))
      .set(bearer(owner.accessToken))
      .send({ category: 'FEED', amount: 25, spentOn: businessToday(), sheepBatchId: batch.id });
    expect(manual.status).toBe(201);
    expect(manual.body.data.batch).toMatchObject({ kind: 'SHEEP', id: batch.id, name: 'Flock S' });

    const items = await list(owner.accessToken, farm.id);
    expect(items).toHaveLength(1);
    const summary = await request(app)
      .get(expenses(farm.id, '/summary'))
      .set(bearer(owner.accessToken));
    expect(summary.body.data).toMatchObject({ totalThisMonth: 100, dailyRecordsTotal: 75 });
    // The sheep batch summary counts its linked manual expense too.
    const batchSummary = await request(app)
      .get(`/api/v1/organizations/${farm.id}/sheep/batches/${batch.id}/summary`)
      .set(bearer(owner.accessToken));
    expect(batchSummary.body.data.totalExpenses).toBe(100);
  });
});

describe('selling a batch permanently deletes its expenses', () => {
  async function summaryOf(token: string, orgId: string) {
    const res = await request(app).get(expenses(orgId, '/summary')).set(bearer(token));
    expect(res.status).toBe(200);
    return res.body.data as {
      totalThisWeek: number;
      totalThisMonth: number;
      dailyAverageThisMonth: number;
      manualTotal: number;
      dailyRecordsTotal: number;
    };
  }
  const sellFlock = (token: string, orgId: string, flockId: string, status = 'CLOSED') =>
    request(app)
      .patch(`/api/v1/organizations/${orgId}/poultry/flocks/${flockId}`)
      .set(bearer(token))
      .send({ status });
  const flockSummary = async (token: string, orgId: string, flockId: string) => {
    const res = await request(app)
      .get(`/api/v1/organizations/${orgId}/poultry/flocks/${flockId}/summary`)
      .set(bearer(token));
    expect(res.status).toBe(200);
    return res.body.data as { totalExpenses: number };
  };

  /** Sold flock: daily 850 + linked manual 400. Other flock: daily 30 + manual 20. Farm-wide: 100. */
  async function seedPoultrySale() {
    const ctx = await setup();
    const { owner, farm, flock } = ctx;
    const other = await createPoultryFlock(app, owner.accessToken, farm.id, {
      name: 'Batch B',
      birdCount: 500,
    });
    await request(app)
      .post(dailyRecords(farm.id, flock.id))
      .set(bearer(owner.accessToken))
      .send({ feedKg: 10, waterLiters: 20, mortalityCount: 3, expenseAmount: 850 })
      .expect(201);
    await seedDailyRecordRow('poultry', other.id, farm.id, businessToday(), { expenseAmount: 30 });
    for (const body of [
      { category: 'FEED', amount: 400, poultryFlockId: flock.id },
      { category: 'MEDICINE', amount: 20, poultryFlockId: other.id },
      { category: 'OTHER', amount: 100 },
    ]) {
      await request(app)
        .post(expenses(farm.id))
        .set(bearer(owner.accessToken))
        .send({ ...body, spentOn: businessToday() })
        .expect(201);
    }
    return { ...ctx, other };
  }

  async function snapshot(farmId: string) {
    const db = getTestDb();
    return {
      manual: await db('farm_expenses')
        .where({ organization_id: farmId })
        .orderBy('amount')
        .select('id', 'amount', 'poultry_flock_id'),
      daily: await db('poultry_daily_records')
        .where({ organization_id: farmId })
        .orderBy('expense_amount')
        .select('id', 'expense_amount', 'mortality_count'),
    };
  }

  it('poultry: a successful sale deletes the sold batch’s manual rows and daily expenses; other batches and farm-wide expenses are untouched', async () => {
    const { owner, farm, flock, other } = await seedPoultrySale();
    expect((await summaryOf(owner.accessToken, farm.id)).totalThisWeek).toBe(1400);
    expect((await flockSummary(owner.accessToken, farm.id, flock.id)).totalExpenses).toBe(1250);

    const sold = await sellFlock(owner.accessToken, farm.id, flock.id);
    expect(sold.status).toBe(200);
    expect(sold.body.data.status).toBe('CLOSED');

    const db = getTestDb();
    // The linked manual expense row is gone from the database.
    expect(await db('farm_expenses').where({ poultry_flock_id: flock.id })).toHaveLength(0);
    // The daily record keeps its non-financial history (mortality drives the
    // remaining-birds figure) but carries no expense any more.
    const soldDaily = await db('poultry_daily_records').where({ poultry_flock_id: flock.id });
    expect(soldDaily).toHaveLength(1);
    expect(Number(soldDaily[0].expense_amount)).toBe(0);
    expect(soldDaily[0].mortality_count).toBe(3);
    expect(sold.body.data.currentBirdCount).toBe(997);

    // Unrelated expenses are untouched.
    const manualLeft = await db('farm_expenses').where({ organization_id: farm.id });
    expect(manualLeft.map((r) => Number(r.amount)).sort((a, b) => a - b)).toEqual([20, 100]);
    const otherDaily = await db('poultry_daily_records').where({ poultry_flock_id: other.id });
    expect(Number(otherDaily[0].expense_amount)).toBe(30);

    // Lists, summaries and the batch report no longer see the deleted lines.
    const items = await list(owner.accessToken, farm.id);
    expect(items.map((i) => Number(i.amount)).sort((a, b) => a - b)).toEqual([20, 100]);
    expect((await summaryOf(owner.accessToken, farm.id)).totalThisMonth).toBe(150);
    expect((await flockSummary(owner.accessToken, farm.id, flock.id)).totalExpenses).toBe(0);
    expect((await flockSummary(owner.accessToken, farm.id, other.id)).totalExpenses).toBe(50);

    // The sale's audit row records what was removed.
    const audit = await db('audit_logs')
      .where({ entity_id: flock.id, action: 'POULTRY_FLOCK_UPDATED' })
      .orderBy('created_at', 'desc')
      .first();
    expect(audit.metadata.soldExpenses).toEqual({
      manualExpensesDeleted: 1,
      dailyRecordExpensesCleared: 1,
      amountRemoved: 1250,
    });

    // Deletion is permanent: reopening the batch brings nothing back.
    await sellFlock(owner.accessToken, farm.id, flock.id, 'ACTIVE').expect(200);
    expect((await summaryOf(owner.accessToken, farm.id)).totalThisMonth).toBe(150);
    expect((await flockSummary(owner.accessToken, farm.id, flock.id)).totalExpenses).toBe(0);
  });

  it('poultry: a refused sale (no farm.batch.sell) preserves every expense', async () => {
    const { owner, farm, flock } = await seedPoultrySale();
    const before = await snapshot(farm.id);
    const vet = await registerApprovedVet(app);
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });

    const refused = await sellFlock(vet.accessToken, farm.id, flock.id);
    expect(refused.status).toBe(403);
    expect(await snapshot(farm.id)).toEqual(before);
    expect((await summaryOf(owner.accessToken, farm.id)).totalThisWeek).toBe(1400);
  });

  it('poultry: a sale that fails inside its transaction rolls the deletion back', async () => {
    const { owner, farm, flock } = await seedPoultrySale();
    const before = await snapshot(farm.id);
    // The audit write runs after the deletion, in the same transaction.
    const spy = vi
      .spyOn(container.auditService, 'record')
      .mockRejectedValueOnce(new Error('simulated failure'));
    try {
      const failed = await sellFlock(owner.accessToken, farm.id, flock.id);
      expect(failed.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await snapshot(farm.id)).toEqual(before);
    const row = await getTestDb()('poultry_flocks').where({ id: flock.id }).first();
    expect(row.status).toBe('ACTIVE');
    expect((await summaryOf(owner.accessToken, farm.id)).totalThisWeek).toBe(1400);
  });

  it('poultry: content edits and repeating CLOSED do not delete anything', async () => {
    const { owner, farm, flock } = await seedPoultrySale();
    const before = await snapshot(farm.id);
    await request(app)
      .patch(`/api/v1/organizations/${farm.id}/poultry/flocks/${flock.id}`)
      .set(bearer(owner.accessToken))
      .send({ name: 'Renamed', status: 'ACTIVE' })
      .expect(200);
    expect(await snapshot(farm.id)).toEqual(before);

    // After the sale, a reopened batch's NEW expenses survive a no-op CLOSED→CLOSED PATCH.
    await sellFlock(owner.accessToken, farm.id, flock.id).expect(200);
    await sellFlock(owner.accessToken, farm.id, flock.id).expect(200);
    await sellFlock(owner.accessToken, farm.id, flock.id, 'ACTIVE').expect(200);
    await request(app)
      .post(expenses(farm.id))
      .set(bearer(owner.accessToken))
      .send({ category: 'FEED', amount: 60, spentOn: businessToday(), poultryFlockId: flock.id })
      .expect(201);
    expect((await flockSummary(owner.accessToken, farm.id, flock.id)).totalExpenses).toBe(60);
    // …and the next sale deletes them too.
    await sellFlock(owner.accessToken, farm.id, flock.id).expect(200);
    expect((await flockSummary(owner.accessToken, farm.id, flock.id)).totalExpenses).toBe(0);
  });

  it('sheep: selling clears the sold batch’s daily expenses only; another active batch keeps its own', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createSheepFarm(app, owner.accessToken, admin.accessToken);
    const sold = await createSheepBatch(app, owner.accessToken, farm.id, { name: 'Sold' });
    const kept = await createSheepBatch(app, owner.accessToken, farm.id, { name: 'Kept' });
    await seedDailyRecordRow('sheep', sold.id, farm.id, businessToday(), { expenseAmount: 75 });
    await seedDailyRecordRow('sheep', kept.id, farm.id, businessToday(), { expenseAmount: 25 });
    expect((await summaryOf(owner.accessToken, farm.id)).totalThisMonth).toBe(100);

    await request(app)
      .patch(`/api/v1/organizations/${farm.id}/sheep/batches/${sold.id}`)
      .set(bearer(owner.accessToken))
      .send({ status: 'CLOSED' })
      .expect(200);
    const db = getTestDb();
    const soldRows = await db('sheep_daily_records').where({ sheep_batch_id: sold.id });
    expect(soldRows).toHaveLength(1);
    expect(Number(soldRows[0].expense_amount)).toBe(0);
    const keptRows = await db('sheep_daily_records').where({ sheep_batch_id: kept.id });
    expect(Number(keptRows[0].expense_amount)).toBe(25);
    expect((await summaryOf(owner.accessToken, farm.id)).totalThisMonth).toBe(25);
  });

  it('sheep / cattle: selling deletes the manual expenses linked to the sold batch only', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const sheepFarm = await createSheepFarm(app, owner.accessToken, admin.accessToken);
    const sold = await createSheepBatch(app, owner.accessToken, sheepFarm.id, { name: 'Sold' });
    const kept = await createSheepBatch(app, owner.accessToken, sheepFarm.id, { name: 'Kept' });
    const cattleFarm = await createCattleFarm(app, owner.accessToken, admin.accessToken);
    const cow = await createCattleBatch(app, owner.accessToken, cattleFarm.id, { name: 'Cow' });
    for (const [farmId, body] of [
      [sheepFarm.id, { amount: 40, sheepBatchId: sold.id }],
      [sheepFarm.id, { amount: 15, sheepBatchId: kept.id }],
      [sheepFarm.id, { amount: 5 }],
      [cattleFarm.id, { amount: 70, cattleBatchId: cow.id }],
    ] as const) {
      await request(app)
        .post(expenses(farmId))
        .set(bearer(owner.accessToken))
        .send({ category: 'FEED', spentOn: businessToday(), ...body })
        .expect(201);
    }

    await request(app)
      .patch(`/api/v1/organizations/${sheepFarm.id}/sheep/batches/${sold.id}`)
      .set(bearer(owner.accessToken))
      .send({ status: 'CLOSED' })
      .expect(200);
    const left = await list(owner.accessToken, sheepFarm.id);
    expect(left.map((i) => Number(i.amount)).sort((a, b) => a - b)).toEqual([5, 15]);
    expect((await summaryOf(owner.accessToken, sheepFarm.id)).manualTotal).toBe(20);

    await request(app)
      .patch(`/api/v1/organizations/${cattleFarm.id}/cattle/batches/${cow.id}`)
      .set(bearer(owner.accessToken))
      .send({ status: 'CLOSED' })
      .expect(200);
    expect(await list(owner.accessToken, cattleFarm.id)).toHaveLength(0);
  });

  it('cattle: selling clears the sold batch’s daily expenses only', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createCattleFarm(app, owner.accessToken, admin.accessToken);
    const sold = await createCattleBatch(app, owner.accessToken, farm.id, { name: 'Sold' });
    const kept = await createCattleBatch(app, owner.accessToken, farm.id, { name: 'Kept' });
    await seedDailyRecordRow('cattle', sold.id, farm.id, businessToday(), { expenseAmount: 40 });
    await seedDailyRecordRow('cattle', kept.id, farm.id, businessToday(), { expenseAmount: 15 });

    await request(app)
      .patch(`/api/v1/organizations/${farm.id}/cattle/batches/${sold.id}`)
      .set(bearer(owner.accessToken))
      .send({ status: 'CLOSED' })
      .expect(200);
    const db = getTestDb();
    const soldRows = await db('cattle_daily_records').where({ cattle_batch_id: sold.id });
    expect(Number(soldRows[0].expense_amount)).toBe(0);
    const keptRows = await db('cattle_daily_records').where({ cattle_batch_id: kept.id });
    expect(Number(keptRows[0].expense_amount)).toBe(15);
    expect((await summaryOf(owner.accessToken, farm.id)).totalThisMonth).toBe(15);
  });
});
