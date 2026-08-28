import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('organization-scoped authorization', () => {
  it('the OWNER has full organization access without any permission rows', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const staff = await registerUser(app);

    // owner can read, add members, list supervisors, update the org, etc.
    await request(app)
      .get(`/api/v1/organizations/${org.id}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: staff.id, role: 'STAFF' })
      .expect(201);
    await request(app)
      .get(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await request(app)
      .patch(`/api/v1/organizations/${org.id}`)
      .set(bearer(owner.accessToken))
      .send({ name: 'Renamed Clinic' })
      .expect(200);
  });

  it('a VETERINARIAN member gets only the org VETERINARIAN role permissions', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    await addOrganizationMember(app, owner.accessToken, org.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });

    // VETERINARIAN role => organization.read + member.read + organization.veterinarian.read
    await request(app)
      .get(`/api/v1/organizations/${org.id}`)
      .set(bearer(vet.accessToken))
      .expect(200);
    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(vet.accessToken))
      .expect(200);
    // ...but NOT member.add / supervisor.read / organization.update
    const other = await registerUser(app);
    await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(vet.accessToken))
      .send({ userId: other.id, role: 'STAFF' })
      .expect(403);
    await request(app)
      .get(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(vet.accessToken))
      .expect(403);
    await request(app)
      .patch(`/api/v1/organizations/${org.id}`)
      .set(bearer(vet.accessToken))
      .send({ name: 'Nope Clinic' })
      .expect(403);
  });

  it('a STAFF member gets only organization.read', async () => {
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

    await request(app)
      .get(`/api/v1/organizations/${org.id}`)
      .set(bearer(staff.accessToken))
      .expect(200);
    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(staff.accessToken))
      .expect(403);
  });

  it('the global ADMIN override grants access to any organization in any state', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    // PENDING organization — non-admins are fully restricted
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'Org C' });

    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .expect(403); // owner, but org not ACTIVE

    // admin can still read members of a pending org
    await request(app)
      .get(`/api/v1/organizations/${org.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(admin.accessToken))
      .expect(200);
  });

  it('cross-organization access is blocked (IDOR) even with an identical role elsewhere', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const clinicA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });

    // ownerA is OWNER of A, nothing in B
    await request(app)
      .get(`/api/v1/organizations/${clinicA.id}`)
      .set(bearer(ownerA.accessToken))
      .expect(200);
    await request(app)
      .patch(`/api/v1/organizations/${clinicB.id}`)
      .set(bearer(ownerA.accessToken))
      .send({ name: 'hijacked' })
      .expect(403);
    await request(app)
      .post(`/api/v1/organizations/${clinicB.id}/supervisors`)
      .set(bearer(ownerA.accessToken))
      .send({ userId: ownerA.id, permissions: ['member.read'] })
      .expect(403);
  });
});

describe('organization lifecycle restrictions', () => {
  it('PENDING / REJECTED / SUSPENDED / DEACTIVATED organizations restrict non-admin operations; ACTIVE is operational', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);

    // PENDING
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'Org C' });
    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .expect(403);

    // ACTIVE
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .expect(200);

    // SUSPENDED
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/suspend`)
      .set(bearer(admin.accessToken))
      .expect(200);
    const suspended = await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken));
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe('ORGANIZATION_NOT_ACTIVE');

    // DEACTIVATED
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/deactivate`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .expect(403);

    // REJECTED (fresh org)
    const org2 = await createOrganization(app, owner.accessToken, { type: 'FARM', name: 'Org F' });
    await request(app)
      .post(`/api/v1/admin/organizations/${org2.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'not acceptable' })
      .expect(200);
    await request(app)
      .get(`/api/v1/organizations/${org2.id}/members`)
      .set(bearer(owner.accessToken))
      .expect(403);
  });
});
