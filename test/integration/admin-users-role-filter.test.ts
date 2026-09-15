import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerApprovedVet, registerUser } from '../helpers/factories.js';

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
