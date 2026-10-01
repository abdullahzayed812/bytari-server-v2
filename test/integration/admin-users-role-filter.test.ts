import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  registerAdmin,
  registerApprovedVet,
  registerModerator,
  registerPendingVet,
  registerRejectedVet,
  registerUser,
  uniqueEmail,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('admin users list — role filter (GET /admin/users?role=)', () => {
  it('narrows to users holding the given global role, and stays unfiltered when omitted', async () => {
    const admin = await registerAdmin(app);
    const petOwner = await registerUser(app);
    const vet = await registerApprovedVet(app);

    // Every registered user (the vet included) is granted PET_OWNER at
    // registration — VETERINARIAN is additive, not a replacement — so the
    // PET_OWNER filter legitimately includes both.
    const petOwners = await request(app)
      .get('/api/v1/admin/users?role=PET_OWNER')
      .set(bearer(admin.accessToken));
    expect(petOwners.status).toBe(200);
    const petOwnerIds = petOwners.body.data.map((u: { id: string }) => u.id);
    expect(petOwnerIds).toEqual(expect.arrayContaining([petOwner.id, vet.id]));

    const vets = await request(app)
      .get('/api/v1/admin/users?role=VETERINARIAN')
      .set(bearer(admin.accessToken));
    expect(vets.status).toBe(200);
    const vetIds = vets.body.data.map((u: { id: string }) => u.id);
    expect(vetIds).toContain(vet.id);
    expect(vetIds).not.toContain(petOwner.id);

    const all = await request(app).get('/api/v1/admin/users').set(bearer(admin.accessToken));
    expect(all.status).toBe(200);
    const allIds = all.body.data.map((u: { id: string }) => u.id);
    expect(allIds).toEqual(expect.arrayContaining([petOwner.id, vet.id, admin.id]));
  });
});

describe('admin users list — account-type split (GET /admin/users?accountType=)', () => {
  const ids = (res: request.Response) => res.body.data.map((u: { id: string }) => u.id);

  it('Pet Owners and Veterinarians pages are disjoint and backend-filtered', async () => {
    const admin = await registerAdmin(app);
    const moderator = await registerModerator(app);
    const petOwner = await registerUser(app);
    // Pet owner whose in-app vet application was rejected — still a pet owner.
    const rejectedApplicant = await registerRejectedVet(app);
    const approvedVet = await registerApprovedVet(app);
    // In-app applicant awaiting review — a pending vet application.
    const pendingApplicant = await registerPendingVet(app);
    // Registered through the Veterinarian path (no email step, awaiting approval).
    const vetSignup = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: uniqueEmail('vetsignup'),
        password: 'correct-horse-battery-staple',
        firstName: 'Vet',
        lastName: 'Signup',
        phone: '+9647700000001',
        accountType: 'VETERINARIAN',
      });
    expect(vetSignup.status).toBe(201);
    const vetSignupId = vetSignup.body.data.user.id as string;

    const owners = await request(app)
      .get('/api/v1/admin/users?accountType=PET_OWNER')
      .set(bearer(admin.accessToken));
    expect(owners.status).toBe(200);
    expect(ids(owners)).toEqual(expect.arrayContaining([petOwner.id, rejectedApplicant.id]));
    for (const id of [approvedVet.id, pendingApplicant.id, vetSignupId, admin.id, moderator.id]) {
      expect(ids(owners)).not.toContain(id);
    }
    expect(owners.body.meta.total).toBe(2);

    const vets = await request(app)
      .get('/api/v1/admin/users?accountType=VETERINARIAN')
      .set(bearer(admin.accessToken));
    expect(vets.status).toBe(200);
    expect(ids(vets)).toEqual(
      expect.arrayContaining([approvedVet.id, pendingApplicant.id, vetSignupId]),
    );
    for (const id of [petOwner.id, rejectedApplicant.id, admin.id, moderator.id]) {
      expect(ids(vets)).not.toContain(id);
    }
    expect(vets.body.meta.total).toBe(3);
  });

  it('rejects an unknown account type and stays admin-only', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const bad = await request(app)
      .get('/api/v1/admin/users?accountType=ADMIN')
      .set(bearer(admin.accessToken));
    expect(bad.status).toBe(422);
    const forbidden = await request(app)
      .get('/api/v1/admin/users?accountType=PET_OWNER')
      .set(bearer(user.accessToken));
    expect(forbidden.status).toBe(403);
  });
});
