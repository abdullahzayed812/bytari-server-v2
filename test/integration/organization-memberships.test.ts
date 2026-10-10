import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
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

describe('organization memberships', () => {
  it('a user can belong to multiple organizations with independent memberships', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);

    const clinicA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const farmC = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'FARM',
    });

    await addOrganizationMember(app, ownerA.accessToken, clinicA.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    await addOrganizationMember(app, ownerB.accessToken, clinicB.id, {
      userId: vet.id,
      role: 'STAFF',
    });
    await addOrganizationMember(app, ownerA.accessToken, farmC.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });

    const mine = await request(app).get('/api/v1/organizations').set(bearer(vet.accessToken));
    const byId = new Map(
      (mine.body.data as Array<{ id: string; myRole: string }>).map((o) => [o.id, o.myRole]),
    );
    expect(byId.get(clinicA.id)).toBe('VETERINARIAN');
    expect(byId.get(clinicB.id)).toBe('STAFF');
    expect(byId.get(farmC.id)).toBe('VETERINARIAN');

    // removing from clinic A does not touch clinic B / farm C
    const memberRow = await request(app)
      .get(`/api/v1/organizations/${clinicA.id}/members?roleKey=VETERINARIAN`)
      .set(bearer(ownerA.accessToken));
    const membershipId = (memberRow.body.data as Array<{ id: string; userId: string }>).find(
      (m) => m.userId === vet.id,
    )?.id;
    await request(app)
      .delete(`/api/v1/organizations/${clinicA.id}/members/${membershipId}`)
      .set(bearer(ownerA.accessToken))
      .expect(200);

    const mineAfter = await request(app).get('/api/v1/organizations').set(bearer(vet.accessToken));
    const idsAfter = (mineAfter.body.data as Array<{ id: string }>).map((o) => o.id);
    expect(idsAfter).not.toContain(clinicA.id);
    expect(idsAfter).toEqual(expect.arrayContaining([clinicB.id, farmC.id]));
  });

  it('prevents a duplicate active membership (409)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_STORE',
    });
    await addOrganizationMember(app, owner.accessToken, org.id, {
      userId: staff.id,
      role: 'STAFF',
    });
    const dup = await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: staff.id, role: 'STAFF' });
    expect(dup.status).toBe(409);
  });

  it('adds a member by email instead of userId', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'FARM',
    });
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ email: staff.email.toUpperCase(), role: 'STAFF' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: staff.id, roleKey: 'STAFF' });
  });

  it('adding by an email with no matching account is a 404', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'FARM',
    });
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ email: 'nobody-with-this-email@example.test', role: 'STAFF' });
    expect(res.status).toBe(404);
  });

  it('rejects a member-add body with both userId and email, or neither', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'FARM',
    });
    const both = await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: staff.id, email: staff.email, role: 'STAFF' });
    expect(both.status).toBe(422);

    const neither = await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ role: 'STAFF' });
    expect(neither.status).toBe(422);
  });

  it('adding a member as VETERINARIAN requires an approved veterinarian', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const plain = await registerUser(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: plain.id, role: 'VETERINARIAN' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VETERINARIAN_APPROVAL_REQUIRED');
  });

  it('member management is organization-scoped — cross-org membership id is 404', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const clinicA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const m = await addOrganizationMember(app, ownerA.accessToken, clinicA.id, {
      userId: staff.id,
      role: 'STAFF',
    });

    // ownerB tries to delete clinic A's membership via clinic B's URL
    const res = await request(app)
      .delete(`/api/v1/organizations/${clinicB.id}/members/${m.id}`)
      .set(bearer(ownerB.accessToken));
    expect(res.status).toBe(404);
  });

  it('a user of Clinic A cannot access Clinic B (cross-organization IDOR → 403)', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const clinicA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    await addOrganizationMember(app, ownerA.accessToken, clinicA.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });

    // vet is a member of A only
    await request(app)
      .get(`/api/v1/organizations/${clinicA.id}/members`)
      .set(bearer(vet.accessToken))
      .expect(200);
    await request(app)
      .get(`/api/v1/organizations/${clinicB.id}`)
      .set(bearer(vet.accessToken))
      .expect(403);
    await request(app)
      .get(`/api/v1/organizations/${clinicB.id}/members`)
      .set(bearer(vet.accessToken))
      .expect(403);
  });

  it('a non-member (not admin) gets 403 for a real organization', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const stranger = await registerUser(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    await request(app)
      .get(`/api/v1/organizations/${org.id}`)
      .set(bearer(stranger.accessToken))
      .expect(403);
  });
});

describe('leaving an organization', () => {
  it('a non-owner member can leave; it does not affect other members', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const other = await registerUser(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await addOrganizationMember(app, owner.accessToken, org.id, {
      userId: staff.id,
      role: 'STAFF',
    });
    await addOrganizationMember(app, owner.accessToken, org.id, {
      userId: other.id,
      role: 'STAFF',
    });

    await request(app)
      .post(`/api/v1/organizations/${org.id}/leave`)
      .set(bearer(staff.accessToken))
      .expect(200);

    // staff can no longer see it, other member still can (has member.read? STAFF doesn't — use owner)
    const mine = await request(app).get('/api/v1/organizations').set(bearer(staff.accessToken));
    expect((mine.body.data as Array<{ id: string }>).map((o) => o.id)).not.toContain(org.id);

    const members = await request(app)
      .get(`/api/v1/organizations/${org.id}/members?status=ACTIVE`)
      .set(bearer(owner.accessToken));
    const activeUserIds = (members.body.data as Array<{ userId: string }>).map((m) => m.userId);
    expect(activeUserIds).toContain(other.id);
    expect(activeUserIds).not.toContain(staff.id);
  });

  it('a clinic supervisor who leaves loses access, supervisor permissions and stays audited', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const sup = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: vet.id, permissions: ['member.read'] })
      .expect(201);
    const membershipId = sup.body.data.id as string;
    await request(app)
      .get(`/api/v1/organizations/${clinic.id}/members`)
      .set(bearer(vet.accessToken))
      .expect(200);

    await request(app)
      .post(`/api/v1/organizations/${clinic.id}/leave`)
      .set(bearer(vet.accessToken))
      .expect(200);

    const db = getTestDb();
    expect(await db('organization_memberships').where({ id: membershipId }).first()).toMatchObject({
      status: 'LEFT',
    });
    expect(
      await db('organization_supervisor_permissions').where({ membership_id: membershipId }),
    ).toHaveLength(0);
    const denied = await request(app)
      .get(`/api/v1/organizations/${clinic.id}/members`)
      .set(bearer(vet.accessToken));
    expect([403, 404]).toContain(denied.status);

    // The clinic and its owner are untouched.
    const org = await db('organizations').where({ id: clinic.id }).first();
    expect(org).toMatchObject({ status: 'ACTIVE', owner_user_id: owner.id });
    await request(app)
      .get(`/api/v1/organizations/${clinic.id}`)
      .set(bearer(owner.accessToken))
      .expect(200);

    const audit = await db('audit_logs')
      .where({ entity_id: membershipId, action: 'ORGANIZATION_MEMBER_REMOVED' })
      .first();
    expect(audit?.actor_user_id).toBe(vet.id);
    expect(audit?.metadata).toMatchObject({ reason: 'left', organizationType: 'CLINIC' });

    // A second leave is a non-member call → 404.
    await request(app)
      .post(`/api/v1/organizations/${clinic.id}/leave`)
      .set(bearer(vet.accessToken))
      .expect(404);
  });

  it('a non-member cannot leave (404) and nothing changes', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const stranger = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await request(app)
      .post(`/api/v1/organizations/${office.id}/leave`)
      .set(bearer(stranger.accessToken))
      .expect(404);
    const rows = await getTestDb()('organization_memberships').where({
      organization_id: office.id,
      status: 'ACTIVE',
    });
    expect(rows).toHaveLength(1);
  });

  it('ownership comes from the organization row — an owner cannot leave even if the role row was altered', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'FARM',
    });
    const db = getTestDb();
    const vetRole = await db('organization_roles').where({ key: 'VETERINARIAN' }).first();
    await db('organization_memberships')
      .where({ organization_id: farm.id, user_id: owner.id })
      .update({ organization_role_id: vetRole.id });
    await request(app)
      .post(`/api/v1/organizations/${farm.id}/leave`)
      .set(bearer(owner.accessToken))
      .expect(409);
    expect(
      await db('organization_memberships')
        .where({ organization_id: farm.id, user_id: owner.id })
        .first(),
    ).toMatchObject({ status: 'ACTIVE' });
  });

  it('the owner cannot leave (organization must not become ownerless) → 409', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    await request(app)
      .post(`/api/v1/organizations/${org.id}/leave`)
      .set(bearer(owner.accessToken))
      .expect(409);
  });

  it('the owner membership cannot be removed by anyone (403)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const ownerMembership = (
      await request(app)
        .get(`/api/v1/organizations/${org.id}/members?roleKey=OWNER`)
        .set(bearer(owner.accessToken))
    ).body.data[0] as { id: string };

    await request(app)
      .delete(`/api/v1/organizations/${org.id}/members/${ownerMembership.id}`)
      .set(bearer(owner.accessToken))
      .expect(403);
    // admin route is blocked too
    await request(app)
      .delete(`/api/v1/admin/organizations/${org.id}/members/${ownerMembership.id}`)
      .set(bearer(admin.accessToken))
      .expect(403);
  });
});
