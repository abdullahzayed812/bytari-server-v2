import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  approveOrganization,
  bearer,
  createOrganization,
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

describe('organization creation', () => {
  it('creates an organization as PENDING with the creator as OWNER member', async () => {
    const vet = await registerApprovedVet(app);
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({ type: 'CLINIC', name: 'Happy Paws Clinic', description: 'Downtown' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'CLINIC',
      name: 'Happy Paws Clinic',
      status: 'PENDING',
      ownerUserId: vet.id,
    });

    // owner membership exists in the membership table
    const membership = (await getTestDb()('organization_memberships as m')
      .join('organization_roles as r', 'r.id', 'm.organization_role_id')
      .where({ 'm.organization_id': res.body.data.id, 'm.user_id': vet.id })
      .select('r.key as role_key', 'm.status')
      .first()) as { role_key: string; status: string };
    expect(membership).toMatchObject({ role_key: 'OWNER', status: 'ACTIVE' });
  });

  it('rejects an invalid organization type with 422', async () => {
    const vet = await registerApprovedVet(app);
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({ type: 'HOSPITAL', name: 'Org X' });
    expect(res.status).toBe(422);
  });

  it('rejects missing/short name with 422', async () => {
    const vet = await registerApprovedVet(app);
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({ type: 'CLINIC', name: 'x' });
    expect(res.status).toBe(422);
  });

  it('FARM organizations get a join code; other types do not', async () => {
    const vet = await registerApprovedVet(app);
    const farm = await createOrganization(app, vet.accessToken, {
      type: 'FARM',
      name: 'Green Farm',
    });
    expect(farm.details.joinCode).toMatch(/^FARM-[A-Z2-9]{6}$/);

    const office = await createOrganization(app, vet.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Office',
    });
    expect(office.details.joinCode).toBeUndefined();
  });

  it('requires no authentication bypass — anonymous cannot create', async () => {
    await request(app)
      .post('/api/v1/organizations')
      .send({ type: 'VETERINARY_STORE', name: 'Anon Store' })
      .expect(401);
  });
});

describe('owner veterinarian requirement', () => {
  it('an approved veterinarian can create a CLINIC and a FARM', async () => {
    const vet = await registerApprovedVet(app);
    await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({ type: 'CLINIC', name: 'Org C' })
      .expect(201);
    await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({ type: 'FARM', name: 'Org F' })
      .expect(201);
  });

  it('a non-veterinarian CANNOT create a CLINIC (403) but CAN create a FARM (201)', async () => {
    const user = await registerUser(app);
    const clinic = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(user.accessToken))
      .send({ type: 'CLINIC', name: 'Org C' });
    expect(clinic.status).toBe(403);
    expect(clinic.body.error.code).toBe('VETERINARIAN_APPROVAL_REQUIRED');

    // A Pet Owner may create their own poultry farm (still PENDING; org-scoped
    // OWNER only). Only CLINIC keeps the approved-vet-owner requirement.
    await request(app)
      .post('/api/v1/organizations')
      .set(bearer(user.accessToken))
      .send({ type: 'FARM', name: 'Org F' })
      .expect(201);
  });

  it('a PENDING veterinarian CANNOT create a CLINIC (403)', async () => {
    const pending = await registerPendingVet(app);
    await request(app)
      .post('/api/v1/organizations')
      .set(bearer(pending.accessToken))
      .send({ type: 'CLINIC', name: 'Org C' })
      .expect(403);
  });

  it('a REJECTED veterinarian CANNOT create a CLINIC (403)', async () => {
    const rejected = await registerRejectedVet(app);
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(rejected.accessToken))
      .send({ type: 'CLINIC', name: 'Org C' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VETERINARIAN_APPROVAL_REQUIRED');
  });

  it('a non-veterinarian CAN create a FARM, VETERINARY_OFFICE and VETERINARY_STORE', async () => {
    const user = await registerUser(app);
    for (const type of ['FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE']) {
      await request(app)
        .post('/api/v1/organizations')
        .set(bearer(user.accessToken))
        .send({ type, name: `Org ${type}` })
        .expect(201);
    }
  });

  it('the server ignores a client-supplied owner / status (no escalation)', async () => {
    const vet = await registerApprovedVet(app);
    const other = await registerUser(app);
    const res = await request(app).post('/api/v1/organizations').set(bearer(vet.accessToken)).send({
      type: 'CLINIC',
      name: 'Org C',
      ownerUserId: other.id,
      status: 'ACTIVE',
      owner_user_id: other.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.ownerUserId).toBe(vet.id);
    expect(res.body.data.status).toBe('PENDING');
  });
});

describe('organization lifecycle (admin)', () => {
  it('admin approves a pending organization → ACTIVE', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const org = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Org C' });

    const res = await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', decidedBy: admin.id });
  });

  it('admin rejects a pending organization with a reason → REJECTED', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const org = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Org C' });

    const res = await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'incomplete documentation' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'incomplete documentation',
    });
  });

  it('cannot approve a non-pending organization (409)', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const org = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Org C' });
    await approveOrganization(app, admin.accessToken, org.id);
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/approve`)
      .set(bearer(admin.accessToken))
      .expect(409);
  });

  it('admin can suspend then activate an active organization', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const org = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Org C' });
    await approveOrganization(app, admin.accessToken, org.id);

    const suspend = await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/suspend`)
      .set(bearer(admin.accessToken));
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.status).toBe('SUSPENDED');

    const activate = await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/activate`)
      .set(bearer(admin.accessToken));
    expect(activate.body.data.status).toBe('ACTIVE');
  });

  it('a non-admin cannot approve / suspend organizations (403)', async () => {
    const vet = await registerApprovedVet(app);
    const other = await registerUser(app);
    const org = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Org C' });
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/approve`)
      .set(bearer(other.accessToken))
      .expect(403);
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/suspend`)
      .set(bearer(other.accessToken))
      .expect(403);
  });

  it('admin pending queue lists only pending organizations', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const a = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Org A' });
    const b = await createOrganization(app, vet.accessToken, { type: 'FARM', name: 'Org B' });
    await approveOrganization(app, admin.accessToken, a.id);

    const res = await request(app)
      .get('/api/v1/admin/organizations/pending')
      .set(bearer(admin.accessToken));
    const ids = (res.body.data as Array<{ id: string }>).map((o) => o.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(a.id);
  });
});
