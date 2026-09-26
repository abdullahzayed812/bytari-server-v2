import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createFarm,
  createPoultryFlock,
  createSheepBatch,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  seedDailyRecordRow,
} from '../helpers/factories.js';
import { businessToday } from '../../src/shared/time/business-date.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const staff = await registerUser(app);
  const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Week Farm' });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: vet.id, role: 'VETERINARIAN' });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: staff.id, role: 'STAFF' });
  const flock = await createPoultryFlock(app, vet.accessToken, farm.id, {
    birdCount: 1000,
    arrivalDate: '2026-02-01',
  });
  return { admin, owner, vet, staff, farm, flock };
}

const daily = (orgId: string, flockId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/poultry/flocks/${flockId}/daily-records${id ? `/${id}` : ''}`;

/** `n` consecutive historical dates ending the day before today. */
function pastDates(n: number): string[] {
  const today = new Date(`${businessToday()}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - (n - i));
    return d.toISOString().slice(0, 10);
  });
}

describe('daily records — weekly sequence (Day 1 … Day 7)', () => {
  it('numbers records by day and returns who added each one', async () => {
    const { vet, farm, flock } = await setup();
    for (const d of pastDates(2)) await seedDailyRecordRow('poultry', flock.id, farm.id, d);
    const created = await request(app)
      .post(daily(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({ feedKg: 12 });
    expect(created.status).toBe(201);
    expect(created.body.data.dayNumber).toBe(3);
    expect(created.body.data.createdBy).toMatchObject({ id: vet.id, firstName: 'Test' });
    expect(created.body.data.createdBy).not.toHaveProperty('email');

    const list = await request(app).get(daily(farm.id, flock.id)).set(bearer(vet.accessToken));
    expect(list.body.data.map((r: { dayNumber: number }) => r.dayNumber)).toEqual([3, 2, 1]);
  });

  it('rejects an eighth daily record for the batch (409 DAILY_RECORD_LIMIT_REACHED)', async () => {
    const { vet, farm, flock } = await setup();
    for (const d of pastDates(7)) await seedDailyRecordRow('poultry', flock.id, farm.id, d);
    const res = await request(app)
      .post(daily(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({ feedKg: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DAILY_RECORD_LIMIT_REACHED');
  });

  it('two simultaneous submissions for the seventh day: exactly one is accepted', async () => {
    const { vet, owner, farm, flock } = await setup();
    for (const d of pastDates(6)) await seedDailyRecordRow('poultry', flock.id, farm.id, d);
    const [a, b] = await Promise.all([
      request(app).post(daily(farm.id, flock.id)).set(bearer(vet.accessToken)).send({ feedKg: 1 }),
      request(app).post(daily(farm.id, flock.id)).set(bearer(owner.accessToken)).send({ feedKg: 2 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const count = (await getTestDb()('poultry_daily_records')
      .where({ poultry_flock_id: flock.id })
      .count({ c: '*' })
      .first()) as { c: string };
    expect(Number(count.c)).toBe(7);
  });

  it('the same cap applies to sheep batches', async () => {
    const { vet, farm } = await setup();
    const batch = await createSheepBatch(app, vet.accessToken, farm.id, {});
    for (const d of pastDates(7)) await seedDailyRecordRow('sheep', batch.id, farm.id, d);
    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/sheep/batches/${batch.id}/daily-records`)
      .set(bearer(vet.accessToken))
      .send({ feedKg: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DAILY_RECORD_LIMIT_REACHED');
  });

  it('edit / delete are authorised: STAFF may not delete, another farm cannot reach the record', async () => {
    const { vet, staff, farm, flock, admin } = await setup();
    const created = await request(app)
      .post(daily(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({ feedKg: 5 });
    const id = created.body.data.id as string;

    const staffDel = await request(app).delete(daily(farm.id, flock.id, id)).set(bearer(staff.accessToken));
    expect(staffDel.status).toBe(403);

    // A vet of ANOTHER farm cannot touch it (cross-farm IDOR).
    const otherOwner = await registerApprovedVet(app);
    const otherFarm = await createFarm(app, otherOwner.accessToken, admin.accessToken, { name: 'Other' });
    const cross = await request(app)
      .delete(daily(otherFarm.id, flock.id, id))
      .set(bearer(otherOwner.accessToken));
    expect([403, 404]).toContain(cross.status);

    const upd = await request(app)
      .patch(daily(farm.id, flock.id, id))
      .set(bearer(vet.accessToken))
      .send({ feedKg: 9 });
    expect(upd.status).toBe(200);
    const del = await request(app).delete(daily(farm.id, flock.id, id)).set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
    const audit = await getTestDb()('audit_logs')
      .where({ action: 'POULTRY_DAILY_RECORD_DELETED', entity_id: id })
      .first();
    expect(audit).toBeTruthy();
  });
});
