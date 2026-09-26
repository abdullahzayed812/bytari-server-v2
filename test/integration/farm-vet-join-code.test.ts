import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
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

describe('farm veterinarians are attached only via the join code', () => {
  it('rejects adding a veterinarian to a FARM by email / userId (409), still allows STAFF', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const byEmail = await request(app)
      .post(`/api/v1/organizations/${farm.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ email: vet.email, role: 'VETERINARIAN' });
    expect(byEmail.status).toBe(409);
    expect(byEmail.body.error.code).toBe('FARM_VETERINARIAN_REQUIRES_JOIN_CODE');

    const byId = await request(app)
      .post(`/api/v1/organizations/${farm.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: vet.id, role: 'VETERINARIAN' });
    expect(byId.status).toBe(409);

    const staffAdd = await request(app)
      .post(`/api/v1/organizations/${farm.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: staff.id, role: 'STAFF' });
    expect(staffAdd.status).toBe(201);

    // promoting that employee to VETERINARIAN would bypass the rule → rejected too
    const promote = await request(app)
      .patch(`/api/v1/organizations/${farm.id}/members/${staffAdd.body.data.id as string}`)
      .set(bearer(owner.accessToken))
      .send({ role: 'VETERINARIAN' });
    expect(promote.status).toBe(409);

    // the join code (the value the farm QR carries) still works
    const joined = await joinFarm(app, vet.accessToken, farm.joinCode);
    expect(joined.status).toBe(201);
    expect(joined.body.data.roleKey).toBe('VETERINARIAN');
  });

  it('other organization types keep direct veterinarian add', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const res = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: vet.id, role: 'VETERINARIAN' });
    expect(res.status).toBe(201);
  });

  it('the join code is only readable by the farm owner (not by a staff member)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await request(app)
      .post(`/api/v1/organizations/${farm.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: staff.id, role: 'STAFF' });
    const res = await request(app)
      .get(`/api/v1/organizations/${farm.id}/join-code`)
      .set(bearer(staff.accessToken));
    expect(res.status).toBe(403);
  });
});
