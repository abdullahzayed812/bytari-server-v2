import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createFarm,
  createPoultryFlock,
  createSheepBatch,
  registerAdmin,
  registerApprovedVet,
  registerUser,
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
  const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Ops Farm' });
  await addOrganizationMember(app, owner.accessToken, farm.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: staff.id, role: 'STAFF' });
  const flock = await createPoultryFlock(app, vet.accessToken, farm.id, {
    birdCount: 500,
    arrivalDate: '2026-02-01',
  });
  return { admin, owner, vet, staff, farm, flock };
}

const flockBase = (orgId: string, flockId: string): string =>
  `/api/v1/organizations/${orgId}/poultry/flocks/${flockId}`;

describe('farm operation records — creator, details, edit, delete', () => {
  it('individual cases carry count + status, can be edited and deleted, and show who added them', async () => {
    const { vet, staff, farm, flock } = await setup();
    const created = await request(app)
      .post(`${flockBase(farm.id, flock.id)}/cases`)
      .set(bearer(vet.accessToken))
      .send({ startedOn: businessToday(), caseCount: 4, diagnosis: 'كوكسيديا' });
    expect(created.status).toBe(201);
    expect(created.body.data.caseCount).toBe(4);
    expect(created.body.data.createdBy).toMatchObject({ id: vet.id, firstName: 'Test' });
    expect(created.body.data.createdBy).not.toHaveProperty('email');
    const id = created.body.data.id as string;

    // STAFF can read the detail (operational data) incl. the creator …
    const read = await request(app)
      .get(`${flockBase(farm.id, flock.id)}/cases/${id}`)
      .set(bearer(staff.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data.createdBy.id).toBe(vet.id);
    // … but may not edit or delete it.
    const staffPatch = await request(app)
      .patch(`${flockBase(farm.id, flock.id)}/cases/${id}`)
      .set(bearer(staff.accessToken))
      .send({ status: 'RECOVERED' });
    expect(staffPatch.status).toBe(403);

    const patch = await request(app)
      .patch(`${flockBase(farm.id, flock.id)}/cases/${id}`)
      .set(bearer(vet.accessToken))
      .send({ status: 'RECOVERED', caseCount: 2 });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({ status: 'RECOVERED', caseCount: 2 });

    const list = await request(app)
      .get(`${flockBase(farm.id, flock.id)}/cases`)
      .set(bearer(vet.accessToken));
    expect(list.body.data[0].createdBy.id).toBe(vet.id);

    const staffDel = await request(app)
      .delete(`${flockBase(farm.id, flock.id)}/cases/${id}`)
      .set(bearer(staff.accessToken));
    expect(staffDel.status).toBe(403);
    const del = await request(app)
      .delete(`${flockBase(farm.id, flock.id)}/cases/${id}`)
      .set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
    const gone = await request(app)
      .get(`${flockBase(farm.id, flock.id)}/cases/${id}`)
      .set(bearer(vet.accessToken));
    expect(gone.status).toBe(404);
  });

  it('treatments, expenses and appointments return the creator and can be deleted by the vet', async () => {
    const { vet, owner, farm, flock } = await setup();
    const health = await request(app)
      .post(`${flockBase(farm.id, flock.id)}/health-events`)
      .set(bearer(vet.accessToken))
      .send({ kind: 'VACCINATION', name: 'نيوكاسل', eventDate: businessToday() });
    expect(health.status).toBe(201);
    expect(health.body.data.createdBy.id).toBe(vet.id);

    const expense = await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/expenses`)
      .set(bearer(owner.accessToken))
      .send({ category: 'FEED', amount: 250000, spentOn: businessToday() });
    expect(expense.status).toBe(201);
    expect(expense.body.data.createdBy.id).toBe(owner.id);

    const appt = await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/appointments`)
      .set(bearer(vet.accessToken))
      .send({ title: 'زيارة بيطرية', scheduledFor: businessToday() });
    expect(appt.status).toBe(201);
    const apptGet = await request(app)
      .get(`/api/v1/organizations/${farm.id}/farm/appointments/${appt.body.data.id}`)
      .set(bearer(owner.accessToken));
    expect(apptGet.body.data.createdBy.id).toBe(vet.id);

    for (const url of [
      `${flockBase(farm.id, flock.id)}/health-events/${health.body.data.id}`,
      `/api/v1/organizations/${farm.id}/farm/expenses/${expense.body.data.id}`,
      `/api/v1/organizations/${farm.id}/farm/appointments/${appt.body.data.id}`,
    ]) {
      const del = await request(app).delete(url).set(bearer(vet.accessToken));
      expect(del.status).toBe(200);
    }
  });

  it('a creator id sent by the client is ignored — the authenticated user is recorded', async () => {
    const { vet, owner, farm, flock } = await setup();
    const res = await request(app)
      .post(`${flockBase(farm.id, flock.id)}/health-events`)
      .set(bearer(vet.accessToken))
      .send({
        kind: 'TREATMENT',
        name: 'مضاد حيوي',
        eventDate: businessToday(),
        createdByUserId: owner.id,
      });
    // Unknown keys are stripped (or rejected); either way the owner is never recorded.
    if (res.status === 201) expect(res.body.data.createdBy.id).toBe(vet.id);
    else expect(res.status).toBe(400);
  });

  it('sheep cases support count + status edits and deletion too', async () => {
    const { vet, farm } = await setup();
    const batch = await createSheepBatch(app, vet.accessToken, farm.id, {});
    const base = `/api/v1/organizations/${farm.id}/sheep/batches/${batch.id}`;
    const c = await request(app)
      .post(`${base}/cases`)
      .set(bearer(vet.accessToken))
      .send({ startedOn: businessToday(), caseCount: 3 });
    expect(c.status).toBe(201);
    expect(c.body.data.createdBy.id).toBe(vet.id);
    const p = await request(app)
      .patch(`${base}/cases/${c.body.data.id}`)
      .set(bearer(vet.accessToken))
      .send({ status: 'DECEASED' });
    expect(p.body.data.status).toBe('DECEASED');
    const d = await request(app)
      .delete(`${base}/cases/${c.body.data.id}`)
      .set(bearer(vet.accessToken));
    expect(d.status).toBe(200);
  });
});
