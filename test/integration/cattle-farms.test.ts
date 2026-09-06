import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  assignOrganizationSupervisor,
  bearer,
  createCattleBatch,
  createFarm,
  joinFarm,
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
  const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Cattle Co' });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: vet.id, role: 'VETERINARIAN' });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: staff.id, role: 'STAFF' });
  return { admin, owner, vet, staff, farm };
}

const batchPath = (orgId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/cattle/batches${id ? `/${id}` : ''}`;

describe('POST /organizations/cattle-farms — Add Cattle Farm', () => {
  it('creates a CATTLE-species FARM org (PENDING) with the profile fields round-tripped', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);

    const create = await request(app)
      .post('/api/v1/organizations/cattle-farms')
      .set(bearer(owner.accessToken))
      .send({
        name: 'مزرعة الأبقار الشمالية',
        location: 'نينوى - الموصل',
        governorate: 'نينوى',
        cattleProductionType: 'DAIRY',
        capacity: 200,
        currentCattleCount: 60,
        contactPhone: '+9647701234567',
      });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({ type: 'FARM', status: 'PENDING', ownerUserId: owner.id });
    const orgId = create.body.data.id as string;

    await request(app)
      .post(`/api/v1/admin/organizations/${orgId}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const profile = await request(app)
      .get(`/api/v1/organizations/${orgId}/farm/profile`)
      .set(bearer(owner.accessToken));
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({
      farmSpecies: 'CATTLE',
      cattleProductionType: 'DAIRY',
      capacity: 200,
      currentCattleCount: 60,
    });
  });

  it('rejects a missing required field (422)', async () => {
    const owner = await registerApprovedVet(app);
    const res = await request(app)
      .post('/api/v1/organizations/cattle-farms')
      .set(bearer(owner.accessToken))
      .send({ name: 'x', location: 'y' });
    expect(res.status).toBe(422);
  });
});

describe('cattle batches — CRUD', () => {
  it('a farm veterinarian can create, read, list, update and delete a batch', async () => {
    const { vet, farm } = await setup();

    const create = await request(app).post(batchPath(farm.id)).set(bearer(vet.accessToken)).send({
      name: 'حقل الأبقار الأول',
      breed: 'هولشتاين',
      headCount: 60,
      calfCount: 10,
      bullCount: 5,
      cowCount: 45,
      arrivalDate: '2026-02-10',
      notes: 'دفعة أولى',
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({
      organizationId: farm.id,
      name: 'حقل الأبقار الأول',
      headCount: 60,
      status: 'ACTIVE',
      createdByUserId: vet.id,
    });

    const read = await request(app).get(batchPath(farm.id, id)).set(bearer(vet.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data.notes).toBe('دفعة أولى');
    expect(read.body.data.cowCount).toBe(45);

    const list = await request(app).get(batchPath(farm.id)).set(bearer(vet.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(batchPath(farm.id, id))
      .set(bearer(vet.accessToken))
      .send({ headCount: 58, cowCount: 43 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.headCount).toBe(58);
    expect(upd.body.data.cowCount).toBe(43);

    const del = await request(app).delete(batchPath(farm.id, id)).set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
    expect(await getTestDb()('cattle_batches').where({ id })).toHaveLength(0);
  });

  it('closing a batch stamps closed_at and blocks further content edits (409)', async () => {
    const { vet, farm } = await setup();
    const batch = await createCattleBatch(app, vet.accessToken, farm.id);

    const close = await request(app)
      .patch(batchPath(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({ status: 'CLOSED' });
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('CLOSED');
    expect(close.body.data.closedAt).not.toBeNull();

    const edit = await request(app)
      .patch(batchPath(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({ headCount: 10 });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('CATTLE_BATCH_NOT_ACTIVE');

    const reopen = await request(app)
      .patch(batchPath(farm.id, batch.id))
      .set(bearer(vet.accessToken))
      .send({ status: 'ACTIVE' });
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.closedAt).toBeNull();
  });

  it('rejects negative head count / future arrival date / blank name (422)', async () => {
    const { vet, farm } = await setup();
    for (const bad of [
      { name: 'x', headCount: -5, arrivalDate: '2026-01-01' },
      { name: 'x', headCount: 1, arrivalDate: '2999-01-01' },
      { name: '', headCount: 1, arrivalDate: '2026-01-01' },
    ]) {
      const res = await request(app).post(batchPath(farm.id)).set(bearer(vet.accessToken)).send(bad);
      expect(res.status).toBe(422);
    }
  });

  it('supports the status list filter', async () => {
    const { vet, farm } = await setup();
    const a = await createCattleBatch(app, vet.accessToken, farm.id);
    await createCattleBatch(app, vet.accessToken, farm.id);
    await request(app)
      .patch(batchPath(farm.id, a.id))
      .set(bearer(vet.accessToken))
      .send({ status: 'CLOSED' });

    const closed = await request(app)
      .get(`${batchPath(farm.id)}?status=CLOSED`)
      .set(bearer(vet.accessToken));
    expect(closed.body.data).toHaveLength(1);
    expect(closed.body.data[0].id).toBe(a.id);
  });
});

describe('cattle batches — authorization', () => {
  it('the farm owner has full access (owner override)', async () => {
    const { owner, farm } = await setup();
    const res = await request(app)
      .post(batchPath(farm.id))
      .set(bearer(owner.accessToken))
      .send({ name: 'Owner batch', headCount: 40, arrivalDate: '2026-01-05' });
    expect(res.status).toBe(201);
  });

  it('a farm STAFF member can read but not write', async () => {
    const { vet, staff, farm } = await setup();
    await createCattleBatch(app, vet.accessToken, farm.id);

    const read = await request(app).get(batchPath(farm.id)).set(bearer(staff.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data).toHaveLength(1);

    const write = await request(app)
      .post(batchPath(farm.id))
      .set(bearer(staff.accessToken))
      .send({ name: 'x', headCount: 1, arrivalDate: '2026-01-01' });
    expect(write.status).toBe(403);
  });

  it('respects a farm SUPERVISOR’s explicitly-assigned permissions', async () => {
    const { owner, farm } = await setup();
    const supervisor = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, owner.accessToken, farm.id, {
      userId: supervisor.id,
      permissions: ['farm.cattle_batch.read'],
    });

    const read = await request(app).get(batchPath(farm.id)).set(bearer(supervisor.accessToken));
    expect(read.status).toBe(200);

    const write = await request(app)
      .post(batchPath(farm.id))
      .set(bearer(supervisor.accessToken))
      .send({ name: 'x', headCount: 1, arrivalDate: '2026-01-01' });
    expect(write.status).toBe(403);
  });

  it('a veterinarian who joined via the code can manage cattle batches', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vet.accessToken, farm.joinCode);

    const res = await request(app).post(batchPath(farm.id)).set(bearer(vet.accessToken)).send({
      name: 'Joined vet batch',
      headCount: 30,
      arrivalDate: '2026-01-02',
    });
    expect(res.status).toBe(201);
  });

  it('denies a non-member (403)', async () => {
    const { farm } = await setup();
    const stranger = await registerUser(app);
    const res = await request(app).get(batchPath(farm.id)).set(bearer(stranger.accessToken));
    expect(res.status).toBe(403);
  });

  it('lets an ADMIN operate on any farm’s cattle batches', async () => {
    const { admin, farm } = await setup();
    const res = await request(app)
      .post(batchPath(farm.id))
      .set(bearer(admin.accessToken))
      .send({ name: 'Admin batch', headCount: 20, arrivalDate: '2026-01-01' });
    expect(res.status).toBe(201);
  });

  it('rejects cattle-batch operations on a non-FARM organization with 400', async () => {
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
      .post(batchPath(clinicId))
      .set(bearer(owner.accessToken))
      .send({ name: 'x', headCount: 1, arrivalDate: '2026-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });
});

describe('cattle batches — cross-farm isolation (IDOR)', () => {
  it('a member of Farm B cannot read Farm A’s batch list (403)', async () => {
    const { farm: farmA } = await setup();
    const admin2 = await registerAdmin(app);
    const ownerB = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const farmB = await createFarm(app, ownerB.accessToken, admin2.accessToken, { name: 'Farm B' });
    await addOrganizationMember(app, ownerB.accessToken, farmB.id, { userId: vetB.id, role: 'VETERINARIAN' });

    const res = await request(app).get(batchPath(farmA.id)).set(bearer(vetB.accessToken));
    expect(res.status).toBe(403);
  });

  it('a batch id from Farm A is invisible under Farm B’s URL (404, not 200)', async () => {
    const { vet, farm: farmA } = await setup();
    const batchA = await createCattleBatch(app, vet.accessToken, farmA.id);

    const admin2 = await registerAdmin(app);
    const ownerB = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const farmB = await createFarm(app, ownerB.accessToken, admin2.accessToken, { name: 'Farm B' });
    await addOrganizationMember(app, ownerB.accessToken, farmB.id, { userId: vetB.id, role: 'VETERINARIAN' });

    const res = await request(app).get(batchPath(farmB.id, batchA.id)).set(bearer(vetB.accessToken));
    expect(res.status).toBe(404);

    const patch = await request(app)
      .patch(batchPath(farmB.id, batchA.id))
      .set(bearer(vetB.accessToken))
      .send({ headCount: 1 });
    expect(patch.status).toBe(404);
  });

  it('the database composite FK refuses a batch that points at a non-FARM organization', async () => {
    const owner = await registerApprovedVet(app);
    const clinicRes = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(owner.accessToken))
      .send({ type: 'CLINIC', name: 'Clinic' });
    const clinicId = clinicRes.body.data.id as string;

    await expect(
      getTestDb()('cattle_batches').insert({
        organization_id: clinicId,
        organization_type: 'FARM',
        name: 'illegal',
        head_count: 1,
        arrival_date: '2026-01-01',
      }),
    ).rejects.toThrow();
  });
});
