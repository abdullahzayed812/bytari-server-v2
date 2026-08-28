import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
  joinFarm,
  registerAdmin,
  registerApprovedVet,
  registerPendingVet,
  registerRejectedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function membershipRow(orgId: string, userId: string) {
  return getTestDb()('organization_memberships as m')
    .join('organization_roles as r', 'r.id', 'm.organization_role_id')
    .where({ 'm.organization_id': orgId, 'm.user_id': userId })
    .select('m.status', 'r.key as role_key')
    .first() as Promise<{ status: string; role_key: string } | undefined>;
}

describe('farm join by code', () => {
  it('an APPROVED veterinarian joins a farm and becomes a VETERINARIAN member', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await joinFarm(app, vet.accessToken, farm.joinCode);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      organizationId: farm.id,
      userId: vet.id,
      roleKey: 'VETERINARIAN',
      status: 'ACTIVE',
    });

    expect(await membershipRow(farm.id, vet.id)).toMatchObject({
      status: 'ACTIVE',
      role_key: 'VETERINARIAN',
    });
  });

  it('accepts the code case-insensitively', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await joinFarm(app, vet.accessToken, farm.joinCode.toLowerCase());
    expect(res.status).toBe(201);
  });

  it('rejects an invalid / unknown join code with 404', async () => {
    const vet = await registerApprovedVet(app);
    const res = await joinFarm(app, vet.accessToken, 'FARM-NOPE99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVALID_JOIN_CODE');
  });

  it('refuses to join a PENDING (not yet approved) farm with 409', async () => {
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    // create without approval
    const createRes = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(owner.accessToken))
      .send({ type: 'FARM', name: 'Pending Farm' });
    const joinCode = createRes.body.data.details.joinCode as string;

    const res = await joinFarm(app, vet.accessToken, joinCode);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORGANIZATION_NOT_ACTIVE');
  });

  it('refuses to join a SUSPENDED farm with 409', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await request(app)
      .post(`/api/v1/admin/organizations/${farm.id}/suspend`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const res = await joinFarm(app, vet.accessToken, farm.joinCode);
    expect(res.status).toBe(409);
  });

  it('rejects a non-veterinarian with 403', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const plain = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await joinFarm(app, plain.accessToken, farm.joinCode);
    expect(res.status).toBe(403);
    expect(await membershipRow(farm.id, plain.id)).toBeUndefined();
  });

  it('rejects a PENDING and a REJECTED veterinarian with 403', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const pending = await registerPendingVet(app);
    const rejected = await registerRejectedVet(app);

    expect((await joinFarm(app, pending.accessToken, farm.joinCode)).status).toBe(403);
    expect((await joinFarm(app, rejected.accessToken, farm.joinCode)).status).toBe(403);
  });

  it('is idempotent — a second join returns the existing membership with 200, no duplicate', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const first = await joinFarm(app, vet.accessToken, farm.joinCode);
    expect(first.status).toBe(201);
    const second = await joinFarm(app, vet.accessToken, farm.joinCode);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const count = await getTestDb()('organization_memberships')
      .where({ organization_id: farm.id, user_id: vet.id })
      .count<{ count: string }>({ count: '*' })
      .first();
    expect(Number(count?.count ?? 0)).toBe(1);
  });

  it('lets a veterinarian rejoin after leaving (LEFT → reactivated)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    await joinFarm(app, vet.accessToken, farm.joinCode);
    await request(app)
      .post(`/api/v1/organizations/${farm.id}/leave`)
      .set(bearer(vet.accessToken))
      .expect(200);
    expect(await membershipRow(farm.id, vet.id)).toMatchObject({ status: 'LEFT' });

    const rejoin = await joinFarm(app, vet.accessToken, farm.joinCode);
    expect(rejoin.status).toBe(201);
    expect(await membershipRow(farm.id, vet.id)).toMatchObject({
      status: 'ACTIVE',
      role_key: 'VETERINARIAN',
    });
  });

  it('refuses a self-service rejoin after the owner removed the member (403)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const joinRes = await joinFarm(app, vet.accessToken, farm.joinCode);
    const membershipId = joinRes.body.data.id as string;
    await request(app)
      .delete(`/api/v1/organizations/${farm.id}/members/${membershipId}`)
      .set(bearer(owner.accessToken))
      .expect(200);

    const rejoin = await joinFarm(app, vet.accessToken, farm.joinCode);
    expect(rejoin.status).toBe(403);
  });
});

describe('multi-farm veterinarian membership', () => {
  it('keeps memberships independent across farms', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farmA = await createFarm(app, ownerA.accessToken, admin.accessToken, { name: 'Farm A' });
    const farmB = await createFarm(app, ownerB.accessToken, admin.accessToken, { name: 'Farm B' });

    expect((await joinFarm(app, vet.accessToken, farmA.joinCode)).status).toBe(201);
    expect((await joinFarm(app, vet.accessToken, farmB.joinCode)).status).toBe(201);

    expect(await membershipRow(farmA.id, vet.id)).toMatchObject({ status: 'ACTIVE' });
    expect(await membershipRow(farmB.id, vet.id)).toMatchObject({ status: 'ACTIVE' });

    // leaving Farm A does not touch Farm B
    await request(app)
      .post(`/api/v1/organizations/${farmA.id}/leave`)
      .set(bearer(vet.accessToken))
      .expect(200);

    expect(await membershipRow(farmA.id, vet.id)).toMatchObject({ status: 'LEFT' });
    expect(await membershipRow(farmB.id, vet.id)).toMatchObject({ status: 'ACTIVE' });

    // `GET /organizations` (mine) still lists Farm B
    const mine = await request(app).get('/api/v1/organizations').set(bearer(vet.accessToken));
    const ids = (mine.body.data as Array<{ id: string }>).map((o) => o.id);
    expect(ids).toContain(farmB.id);
    expect(ids).not.toContain(farmA.id);
  });

  it('leaving a farm does not affect the veterinarian’s approval status', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    await joinFarm(app, vet.accessToken, farm.joinCode);
    await request(app)
      .post(`/api/v1/organizations/${farm.id}/leave`)
      .set(bearer(vet.accessToken))
      .expect(200);

    const status = await request(app)
      .get('/api/v1/veterinarians/me/status')
      .set(bearer(vet.accessToken));
    expect(status.status).toBe(200);
    expect(status.body.data.veterinarianStatus).toBe('APPROVED');
  });
});

describe('farm join code regeneration', () => {
  it('lets the owner rotate the code; the old code stops working', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const regen = await request(app)
      .post(`/api/v1/organizations/${farm.id}/join-code/regenerate`)
      .set(bearer(owner.accessToken));
    expect(regen.status).toBe(200);
    const newCode = regen.body.data.joinCode as string;
    expect(newCode).not.toBe(farm.joinCode);

    expect((await joinFarm(app, vet.accessToken, farm.joinCode)).status).toBe(404);
    expect((await joinFarm(app, vet.accessToken, newCode)).status).toBe(201);
  });

  it('does not let a plain farm veterinarian regenerate the code (403)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vet.accessToken, farm.joinCode);

    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/join-code/regenerate`)
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(403);
  });

  it('rejects join-code operations on a non-FARM organization with 400', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinicRes = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(owner.accessToken))
      .send({ type: 'CLINIC', name: 'A Clinic' });
    const clinicId = clinicRes.body.data.id as string;
    await request(app)
      .post(`/api/v1/admin/organizations/${clinicId}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/organizations/${clinicId}/join-code/regenerate`)
      .set(bearer(owner.accessToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });
});
