import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup(): Promise<{
  admin: Awaited<ReturnType<typeof registerAdmin>>;
  owner: Awaited<ReturnType<typeof registerApprovedVet>>;
  org: Awaited<ReturnType<typeof createActiveOrganization>>;
}> {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
    type: 'CLINIC',
  });
  return { admin, owner, org };
}

describe('organization supervisors', () => {
  it('the owner assigns an approved veterinarian as supervisor with selected permissions', async () => {
    const { owner, org } = await setup();
    const vet = await registerApprovedVet(app);

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: vet.id, permissions: ['member.read', 'member.update'] });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      userId: vet.id,
      roleKey: 'SUPERVISOR',
      status: 'ACTIVE',
    });
    expect(res.body.data.permissions.sort()).toEqual(['member.read', 'member.update']);
  });

  it('cannot assign a non-approved veterinarian as supervisor (403)', async () => {
    const { owner, org } = await setup();
    const plain = await registerUser(app);
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: plain.id, permissions: ['member.read'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VETERINARIAN_APPROVAL_REQUIRED');
  });

  it('the owner may assign multiple supervisors with different permission sets', async () => {
    const { owner, org } = await setup();
    const s1 = await registerApprovedVet(app);
    const s2 = await registerApprovedVet(app);

    await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: s1.id, permissions: ['member.read', 'member.update'] })
      .expect(201);
    await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({
        userId: s2.id,
        permissions: ['organization.veterinarian.read', 'organization.veterinarian.manage'],
      })
      .expect(201);

    const list = await request(app)
      .get(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken));
    const bySupervisor = new Map(
      (list.body.data as Array<{ userId: string; permissions: string[] }>).map((s) => [
        s.userId,
        s.permissions.sort(),
      ]),
    );
    expect(bySupervisor.get(s1.id)).toEqual(['member.read', 'member.update']);
    expect(bySupervisor.get(s2.id)).toEqual([
      'organization.veterinarian.manage',
      'organization.veterinarian.read',
    ]);
  });

  it('supervisor permissions are organization-scoped only', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const supervisor = await registerApprovedVet(app);
    const clinicA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });

    await request(app)
      .post(`/api/v1/organizations/${clinicA.id}/supervisors`)
      .set(bearer(ownerA.accessToken))
      .send({ userId: supervisor.id, permissions: ['member.read', 'member.remove'] })
      .expect(201);

    // has member.read in A
    await request(app)
      .get(`/api/v1/organizations/${clinicA.id}/members`)
      .set(bearer(supervisor.accessToken))
      .expect(200);
    // no membership in B at all
    await request(app)
      .get(`/api/v1/organizations/${clinicB.id}/members`)
      .set(bearer(supervisor.accessToken))
      .expect(403);
  });

  it('a supervisor cannot assign themselves (403)', async () => {
    const { owner, org } = await setup();
    const supervisor = await registerApprovedVet(app);
    await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: supervisor.id, permissions: ['supervisor.assign', 'member.read'] })
      .expect(201);

    // supervisor now holds supervisor.assign — but still cannot assign self
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(supervisor.accessToken))
      .send({ userId: supervisor.id, permissions: ['member.remove'] });
    expect(res.status).toBe(403);
  });

  it('the owner cannot be assigned as a supervisor of their own organization (403)', async () => {
    const { owner, org } = await setup();
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: owner.id, permissions: ['member.read'] });
    expect(res.status).toBe(403);
  });

  it('a member without supervisor.assign cannot assign supervisors (403)', async () => {
    const { admin, owner, org } = await setup();
    const staff = await registerUser(app);
    const vet = await registerApprovedVet(app);
    await addOrganizationMember(app, owner.accessToken, org.id, {
      userId: staff.id,
      role: 'STAFF',
    });

    await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(staff.accessToken))
      .send({ userId: vet.id, permissions: ['member.read'] })
      .expect(403);
    void admin;
  });

  it('updating a supervisor’s permissions replaces the whole set', async () => {
    const { owner, org } = await setup();
    const supervisor = await registerApprovedVet(app);
    const assign = await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: supervisor.id, permissions: ['member.read', 'member.update'] });
    const membershipId = assign.body.data.id as string;

    // supervisor can update members now
    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(supervisor.accessToken))
      .expect(200);

    const patch = await request(app)
      .patch(`/api/v1/organizations/${org.id}/supervisors/${membershipId}`)
      .set(bearer(owner.accessToken))
      .send({ permissions: ['organization.veterinarian.read'] });
    expect(patch.status).toBe(200);
    expect(patch.body.data.permissions).toEqual(['organization.veterinarian.read']);

    // member.read is gone now
    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(supervisor.accessToken))
      .expect(403);
  });

  it('removing a supervisor deactivates the membership and clears permissions', async () => {
    const { owner, org } = await setup();
    const supervisor = await registerApprovedVet(app);
    const assign = await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: supervisor.id, permissions: ['member.read'] });
    const membershipId = assign.body.data.id as string;

    await request(app)
      .delete(`/api/v1/organizations/${org.id}/supervisors/${membershipId}`)
      .set(bearer(owner.accessToken))
      .expect(200);

    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(supervisor.accessToken))
      .expect(403);
    const list = await request(app)
      .get(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken));
    expect((list.body.data as unknown[]).length).toBe(0);
  });

  it('rejects unknown permission keys (400)', async () => {
    const { owner, org } = await setup();
    const supervisor = await registerApprovedVet(app);
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: supervisor.id, permissions: ['animals.read'] });
    expect(res.status).toBe(422);
  });
});
