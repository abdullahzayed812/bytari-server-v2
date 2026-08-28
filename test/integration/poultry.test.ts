import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  assignOrganizationSupervisor,
  bearer,
  createFarm,
  createPoultryFlock,
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
  const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Poultry Co' });
  await addOrganizationMember(app, owner.accessToken, farm.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, owner.accessToken, farm.id, {
    userId: staff.id,
    role: 'STAFF',
  });
  return { admin, owner, vet, staff, farm };
}

const flockPath = (orgId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/poultry/flocks${id ? `/${id}` : ''}`;

describe('poultry flocks — CRUD', () => {
  it('a farm veterinarian can create, read, list, update and delete a flock', async () => {
    const { vet, farm } = await setup();

    const create = await request(app).post(flockPath(farm.id)).set(bearer(vet.accessToken)).send({
      name: 'House 1',
      birdType: 'CHICKEN',
      birdCount: 12000,
      arrivalDate: '2026-02-10',
      notes: 'Ross 308',
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({
      organizationId: farm.id,
      name: 'House 1',
      birdType: 'CHICKEN',
      birdCount: 12000,
      status: 'ACTIVE',
      createdByUserId: vet.id,
    });

    const read = await request(app).get(flockPath(farm.id, id)).set(bearer(vet.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data.notes).toBe('Ross 308');

    const list = await request(app).get(flockPath(farm.id)).set(bearer(vet.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);

    const upd = await request(app)
      .patch(flockPath(farm.id, id))
      .set(bearer(vet.accessToken))
      .send({ birdCount: 11800 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.birdCount).toBe(11800);

    const del = await request(app).delete(flockPath(farm.id, id)).set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
    expect(await getTestDb()('poultry_flocks').where({ id })).toHaveLength(0);
  });

  it('closing a flock stamps closed_at and blocks further content edits (409)', async () => {
    const { vet, farm } = await setup();
    const flock = await createPoultryFlock(app, vet.accessToken, farm.id);

    const close = await request(app)
      .patch(flockPath(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({ status: 'CLOSED' });
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('CLOSED');
    expect(close.body.data.closedAt).not.toBeNull();

    const edit = await request(app)
      .patch(flockPath(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({ birdCount: 10 });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('POULTRY_FLOCK_NOT_ACTIVE');

    // re-opening (status-only change) is allowed
    const reopen = await request(app)
      .patch(flockPath(farm.id, flock.id))
      .set(bearer(vet.accessToken))
      .send({ status: 'ACTIVE' });
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.closedAt).toBeNull();
  });

  it('rejects invalid bird type / negative count / future arrival date (422)', async () => {
    const { vet, farm } = await setup();
    for (const bad of [
      { name: 'x', birdType: 'DRAGON', birdCount: 1, arrivalDate: '2026-01-01' },
      { name: 'x', birdType: 'CHICKEN', birdCount: -5, arrivalDate: '2026-01-01' },
      { name: 'x', birdType: 'CHICKEN', birdCount: 1, arrivalDate: '2999-01-01' },
      { name: '', birdType: 'CHICKEN', birdCount: 1, arrivalDate: '2026-01-01' },
    ]) {
      const res = await request(app)
        .post(flockPath(farm.id))
        .set(bearer(vet.accessToken))
        .send(bad);
      expect(res.status).toBe(422);
    }
  });

  it('supports status + birdType list filters', async () => {
    const { vet, farm } = await setup();
    const a = await createPoultryFlock(app, vet.accessToken, farm.id, { birdType: 'CHICKEN' });
    await createPoultryFlock(app, vet.accessToken, farm.id, { birdType: 'DUCK' });
    await request(app)
      .patch(flockPath(farm.id, a.id))
      .set(bearer(vet.accessToken))
      .send({ status: 'CLOSED' });

    const ducks = await request(app)
      .get(`${flockPath(farm.id)}?birdType=DUCK`)
      .set(bearer(vet.accessToken));
    expect(ducks.body.data).toHaveLength(1);

    const closed = await request(app)
      .get(`${flockPath(farm.id)}?status=CLOSED`)
      .set(bearer(vet.accessToken));
    expect(closed.body.data).toHaveLength(1);
    expect(closed.body.data[0].id).toBe(a.id);
  });
});

describe('poultry flocks — authorization', () => {
  it('the farm owner has full access (owner override)', async () => {
    const { owner, farm } = await setup();
    const res = await request(app)
      .post(flockPath(farm.id))
      .set(bearer(owner.accessToken))
      .send({ name: 'Owner house', birdType: 'TURKEY', birdCount: 100, arrivalDate: '2026-01-05' });
    expect(res.status).toBe(201);
  });

  it('a farm STAFF member can read but not write', async () => {
    const { vet, staff, farm } = await setup();
    await createPoultryFlock(app, vet.accessToken, farm.id);

    const read = await request(app).get(flockPath(farm.id)).set(bearer(staff.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data).toHaveLength(1);

    const write = await request(app)
      .post(flockPath(farm.id))
      .set(bearer(staff.accessToken))
      .send({ name: 'x', birdType: 'CHICKEN', birdCount: 1, arrivalDate: '2026-01-01' });
    expect(write.status).toBe(403);
  });

  it('respects a farm SUPERVISOR’s explicitly-assigned permissions', async () => {
    const { owner, farm } = await setup();
    const supervisor = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, owner.accessToken, farm.id, {
      userId: supervisor.id,
      permissions: ['farm.poultry.read'],
    });

    const read = await request(app).get(flockPath(farm.id)).set(bearer(supervisor.accessToken));
    expect(read.status).toBe(200);

    const write = await request(app)
      .post(flockPath(farm.id))
      .set(bearer(supervisor.accessToken))
      .send({ name: 'x', birdType: 'CHICKEN', birdCount: 1, arrivalDate: '2026-01-01' });
    expect(write.status).toBe(403);
  });

  it('a veterinarian who joined via the code can manage poultry', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vet.accessToken, farm.joinCode);

    const res = await request(app).post(flockPath(farm.id)).set(bearer(vet.accessToken)).send({
      name: 'Joined vet house',
      birdType: 'QUAIL',
      birdCount: 300,
      arrivalDate: '2026-01-02',
    });
    expect(res.status).toBe(201);
  });

  it('denies a non-member (403)', async () => {
    const { farm } = await setup();
    const stranger = await registerUser(app);
    const res = await request(app).get(flockPath(farm.id)).set(bearer(stranger.accessToken));
    expect(res.status).toBe(403);
  });

  it('lets an ADMIN operate on any farm’s poultry', async () => {
    const { admin, farm } = await setup();
    const res = await request(app)
      .post(flockPath(farm.id))
      .set(bearer(admin.accessToken))
      .send({ name: 'Admin house', birdType: 'GOOSE', birdCount: 50, arrivalDate: '2026-01-01' });
    expect(res.status).toBe(201);
  });

  it('rejects poultry operations on a non-FARM organization with 400', async () => {
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
      .post(flockPath(clinicId))
      .set(bearer(owner.accessToken))
      .send({ name: 'x', birdType: 'CHICKEN', birdCount: 1, arrivalDate: '2026-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });
});

describe('poultry flocks — cross-farm isolation (IDOR)', () => {
  it('a member of Farm B cannot read Farm A’s flock list (403)', async () => {
    const { farm: farmA } = await setup();
    const admin2 = await registerAdmin(app);
    const ownerB = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const farmB = await createFarm(app, ownerB.accessToken, admin2.accessToken, { name: 'Farm B' });
    await addOrganizationMember(app, ownerB.accessToken, farmB.id, {
      userId: vetB.id,
      role: 'VETERINARIAN',
    });

    const res = await request(app).get(flockPath(farmA.id)).set(bearer(vetB.accessToken));
    expect(res.status).toBe(403);
  });

  it('a flock id from Farm A is invisible under Farm B’s URL (404, not 200)', async () => {
    const { vet, farm: farmA } = await setup();
    const flockA = await createPoultryFlock(app, vet.accessToken, farmA.id);

    const admin2 = await registerAdmin(app);
    const ownerB = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const farmB = await createFarm(app, ownerB.accessToken, admin2.accessToken, { name: 'Farm B' });
    await addOrganizationMember(app, ownerB.accessToken, farmB.id, {
      userId: vetB.id,
      role: 'VETERINARIAN',
    });

    const res = await request(app)
      .get(flockPath(farmB.id, flockA.id))
      .set(bearer(vetB.accessToken));
    expect(res.status).toBe(404);

    const patch = await request(app)
      .patch(flockPath(farmB.id, flockA.id))
      .set(bearer(vetB.accessToken))
      .send({ birdCount: 1 });
    expect(patch.status).toBe(404);

    // and Farm A's flock is untouched
    expect(
      (await getTestDb()('poultry_flocks').where({ id: flockA.id }).first()) as {
        bird_count: number;
      },
    ).toMatchObject({});
  });

  it('the database composite FK refuses a flock that points at a non-FARM organization', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinicRes = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(owner.accessToken))
      .send({ type: 'CLINIC', name: 'Clinic' });
    const clinicId = clinicRes.body.data.id as string;
    void admin;

    await expect(
      getTestDb()('poultry_flocks').insert({
        organization_id: clinicId,
        organization_type: 'FARM',
        name: 'illegal',
        bird_type: 'CHICKEN',
        bird_count: 1,
        arrival_date: '2026-01-01',
      }),
    ).rejects.toThrow();
  });
});
