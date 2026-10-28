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
} from '../helpers/factories.js';
import { businessToday } from '../../src/shared/time/business-date.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

type Kind = 'poultry' | 'sheep' | 'cattle';

const LINK: Record<Kind, { key: string; column: string; path: string }> = {
  poultry: { key: 'poultryFlockId', column: 'poultry_flock_id', path: 'poultry/flocks' },
  sheep: { key: 'sheepBatchId', column: 'sheep_batch_id', path: 'sheep/batches' },
  cattle: { key: 'cattleBatchId', column: 'cattle_batch_id', path: 'cattle/batches' },
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

const appointments = (farmId: string) => `/api/v1/organizations/${farmId}/farm/appointments`;

async function addAppointment(kind: Kind, token: string, farmId: string, batchId?: string) {
  const res = await request(app)
    .post(appointments(farmId))
    .set(bearer(token))
    .send({
      title: batchId ? `for ${batchId}` : 'farm-wide',
      scheduledFor: businessToday(),
      ...(batchId ? { [LINK[kind].key]: batchId } : {}),
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; batch: { id: string; name: string } | null };
}

const sell = (kind: Kind, token: string, farmId: string, batchId: string, status = 'CLOSED') =>
  request(app)
    .patch(`/api/v1/organizations/${farmId}/${LINK[kind].path}/${batchId}`)
    .set(bearer(token))
    .send({ status });

async function listIds(token: string, farmId: string): Promise<string[]> {
  const res = await request(app).get(appointments(farmId)).set(bearer(token));
  expect(res.status).toBe(200);
  return (res.body.data as { id: string }[]).map((a) => a.id).sort();
}

describe.each<Kind>(['poultry', 'sheep', 'cattle'])(
  '%s: selling a batch permanently deletes its appointments',
  (kind) => {
    it('deletes only the sold batch’s appointments; other batches and farm-wide ones stay', async () => {
      const { owner, farm, sold, kept } = await seedFarm(kind);
      const soldA = await addAppointment(kind, owner.accessToken, farm.id, sold.id);
      await addAppointment(kind, owner.accessToken, farm.id, sold.id);
      const keptA = await addAppointment(kind, owner.accessToken, farm.id, kept.id);
      const farmWide = await addAppointment(kind, owner.accessToken, farm.id);
      expect(soldA.batch).toMatchObject({ id: sold.id, name: 'Sold' });

      const res = await sell(kind, owner.accessToken, farm.id, sold.id);
      expect(res.status).toBe(200);

      const db = getTestDb();
      expect(await db('farm_appointments').where(LINK[kind].column, sold.id)).toHaveLength(0);
      expect(await listIds(owner.accessToken, farm.id)).toEqual([keptA.id, farmWide.id].sort());
      const detail = await request(app)
        .get(`${appointments(farm.id)}/${soldA.id}`)
        .set(bearer(owner.accessToken));
      expect(detail.status).toBe(404);

      const audit = await db('audit_logs')
        .where({ entity_id: sold.id })
        .whereRaw(`metadata \\? 'soldRecords'`)
        .first();
      expect(audit.metadata.soldRecords.appointmentsDeleted).toBe(2);

      // Permanent: reopening restores nothing.
      await sell(kind, owner.accessToken, farm.id, sold.id, 'ACTIVE').expect(200);
      expect(await db('farm_appointments').where(LINK[kind].column, sold.id)).toHaveLength(0);
    });

    it('a sale that fails inside its transaction keeps every appointment', async () => {
      const { owner, farm, sold } = await seedFarm(kind);
      await addAppointment(kind, owner.accessToken, farm.id, sold.id);
      const before = await listIds(owner.accessToken, farm.id);
      const auditSpy = vi
        .spyOn(container.auditService, 'record')
        .mockRejectedValueOnce(new Error('simulated failure'));
      try {
        expect((await sell(kind, owner.accessToken, farm.id, sold.id)).status).toBe(500);
      } finally {
        auditSpy.mockRestore();
      }
      expect(await listIds(owner.accessToken, farm.id)).toEqual(before);
    });

    it('a content edit (no sale) deletes nothing; a sold batch takes no new appointments', async () => {
      const { owner, farm, sold } = await seedFarm(kind);
      await addAppointment(kind, owner.accessToken, farm.id, sold.id);
      await request(app)
        .patch(`/api/v1/organizations/${farm.id}/${LINK[kind].path}/${sold.id}`)
        .set(bearer(owner.accessToken))
        .send({ name: 'Renamed' })
        .expect(200);
      expect(await listIds(owner.accessToken, farm.id)).toHaveLength(1);

      await sell(kind, owner.accessToken, farm.id, sold.id).expect(200);
      const late = await request(app)
        .post(appointments(farm.id))
        .set(bearer(owner.accessToken))
        .send({ title: 'late', scheduledFor: businessToday(), [LINK[kind].key]: sold.id });
      expect(late.status).toBe(422);
    });
  },
);
