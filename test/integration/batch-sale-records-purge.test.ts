import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
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

type Kind = 'poultry' | 'sheep' | 'cattle';

const TABLES: Record<
  Kind,
  { fk: string; events: string; cases: string; daily: string; path: string }
> = {
  poultry: {
    fk: 'poultry_flock_id',
    events: 'poultry_health_events',
    cases: 'poultry_cases',
    daily: 'poultry_daily_records',
    path: 'poultry/flocks',
  },
  sheep: {
    fk: 'sheep_batch_id',
    events: 'sheep_health_events',
    cases: 'sheep_cases',
    daily: 'sheep_daily_records',
    path: 'sheep/batches',
  },
  cattle: {
    fk: 'cattle_batch_id',
    events: 'cattle_health_events',
    cases: 'cattle_cases',
    daily: 'cattle_daily_records',
    path: 'cattle/batches',
  },
};

async function seedFarm(kind: Kind) {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  if (kind === 'poultry') {
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const sold = await createPoultryFlock(app, owner.accessToken, farm.id, { name: 'Sold' });
    const kept = await createPoultryFlock(app, owner.accessToken, farm.id, { name: 'Kept' });
    return { owner, farm, sold, kept };
  }
  const farm =
    kind === 'sheep'
      ? await createSheepFarm(app, owner.accessToken, admin.accessToken)
      : await createCattleFarm(app, owner.accessToken, admin.accessToken);
  const create = kind === 'sheep' ? createSheepBatch : createCattleBatch;
  const sold = await create(app, owner.accessToken, farm.id, { name: 'Sold' });
  const kept = await create(app, owner.accessToken, farm.id, { name: 'Kept' });
  return { owner, farm, sold, kept };
}

/** One treatment, one vaccination, one sick case (with image) and a daily treatment note per batch. */
async function seedHealth(kind: Kind, farmId: string, batchId: string, imageKey: string) {
  const t = TABLES[kind];
  const db = getTestDb();
  const base = { [t.fk]: batchId, organization_id: farmId, organization_type: 'FARM' };
  await db(t.events).insert([
    { ...base, kind: 'TREATMENT', name: 'Antibiotic', event_date: businessToday() },
    { ...base, kind: 'VACCINATION', name: 'Newcastle', event_date: businessToday() },
  ]);
  await db(t.cases).insert({
    ...base,
    case_number: 1,
    started_on: businessToday(),
    image_key: imageKey,
  });
  await seedDailyRecordRow(kind, batchId, farmId, businessToday(), { mortalityCount: 2 });
  await db(t.daily).where(t.fk, batchId).update({ treatment: 'vitamins' });
}

const sell = (kind: Kind, token: string, farmId: string, batchId: string, status = 'CLOSED') =>
  request(app)
    .patch(`/api/v1/organizations/${farmId}/${TABLES[kind].path}/${batchId}`)
    .set(bearer(token))
    .send({ status });

async function counts(kind: Kind, batchId: string) {
  const t = TABLES[kind];
  const db = getTestDb();
  const count = async (table: string) =>
    Number(((await db(table).where(t.fk, batchId).count('* as n').first()) as { n: string }).n);
  const daily = await db(t.daily).where(t.fk, batchId);
  return {
    events: await count(t.events),
    cases: await count(t.cases),
    dailyRecords: daily.length,
    dailyTreatments: daily.filter((d) => d.treatment !== null).length,
  };
}

describe.each<Kind>(['poultry', 'sheep', 'cattle'])(
  '%s: selling a batch permanently deletes its treatments, vaccinations and sick cases',
  (kind) => {
    it('deletes only the sold batch’s records, keeps the daily history, and cleans up case images', async () => {
      const { owner, farm, sold, kept } = await seedFarm(kind);
      await seedHealth(kind, farm.id, sold.id, `organization-files/sold-${kind}.jpg`);
      await seedHealth(kind, farm.id, kept.id, `organization-files/kept-${kind}.jpg`);
      const storageDelete = vi.spyOn(container.objectStorage, 'delete').mockResolvedValue();

      try {
        const res = await sell(kind, owner.accessToken, farm.id, sold.id);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('CLOSED');
        expect(storageDelete).toHaveBeenCalledTimes(1);
        expect(storageDelete).toHaveBeenCalledWith(`organization-files/sold-${kind}.jpg`);
      } finally {
        storageDelete.mockRestore();
      }

      expect(await counts(kind, sold.id)).toEqual({
        events: 0,
        cases: 0,
        dailyRecords: 1,
        dailyTreatments: 0,
      });
      expect(await counts(kind, kept.id)).toEqual({
        events: 2,
        cases: 1,
        dailyRecords: 1,
        dailyTreatments: 1,
      });

      // The batch's own list endpoints no longer return the deleted rows.
      const base = `/api/v1/organizations/${farm.id}/${TABLES[kind].path}`;
      for (const suffix of ['health-events', 'cases']) {
        const soldList = await request(app)
          .get(`${base}/${sold.id}/${suffix}`)
          .set(bearer(owner.accessToken));
        expect(soldList.status).toBe(200);
        expect(soldList.body.data).toHaveLength(0);
        const keptList = await request(app)
          .get(`${base}/${kept.id}/${suffix}`)
          .set(bearer(owner.accessToken));
        expect(keptList.body.data.length).toBeGreaterThan(0);
      }

      const audit = await getTestDb()('audit_logs')
        .where({ entity_id: sold.id })
        .whereRaw(`metadata \\? 'soldRecords'`)
        .first();
      expect(audit.metadata.soldRecords).toEqual({
        treatmentsDeleted: 1,
        vaccinationsDeleted: 1,
        casesDeleted: 1,
        dailyRecordTreatmentsCleared: 1,
      });

      // Permanent: reopening brings nothing back.
      await sell(kind, owner.accessToken, farm.id, sold.id, 'ACTIVE').expect(200);
      expect((await counts(kind, sold.id)).events).toBe(0);
    });

    it('a sale that fails inside its transaction deletes nothing', async () => {
      const { owner, farm, sold } = await seedFarm(kind);
      await seedHealth(kind, farm.id, sold.id, `organization-files/rollback-${kind}.jpg`);
      const before = await counts(kind, sold.id);
      const auditSpy = vi
        .spyOn(container.auditService, 'record')
        .mockRejectedValueOnce(new Error('simulated failure'));
      const storageDelete = vi.spyOn(container.objectStorage, 'delete').mockResolvedValue();
      try {
        expect((await sell(kind, owner.accessToken, farm.id, sold.id)).status).toBe(500);
        expect(storageDelete).not.toHaveBeenCalled();
      } finally {
        auditSpy.mockRestore();
        storageDelete.mockRestore();
      }
      expect(await counts(kind, sold.id)).toEqual(before);
    });

    it('content edits on a reopened batch delete nothing; the next sale does', async () => {
      const { owner, farm, sold } = await seedFarm(kind);
      await sell(kind, owner.accessToken, farm.id, sold.id).expect(200);
      await sell(kind, owner.accessToken, farm.id, sold.id, 'ACTIVE').expect(200);
      await seedHealth(kind, farm.id, sold.id, `organization-files/again-${kind}.jpg`);
      await request(app)
        .patch(`/api/v1/organizations/${farm.id}/${TABLES[kind].path}/${sold.id}`)
        .set(bearer(owner.accessToken))
        .send({ name: 'Renamed' })
        .expect(200);
      expect((await counts(kind, sold.id)).events).toBe(2);
      const storageDelete = vi.spyOn(container.objectStorage, 'delete').mockResolvedValue();
      try {
        await sell(kind, owner.accessToken, farm.id, sold.id).expect(200);
      } finally {
        storageDelete.mockRestore();
      }
      expect(await counts(kind, sold.id)).toMatchObject({ events: 0, cases: 0 });
    });
  },
);
