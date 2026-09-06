import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, createOrganization, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('poultry farm creation & approval', () => {
  it('a Pet Owner (no veterinarian approval) can create a farm — it starts PENDING', async () => {
    const owner = await registerUser(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'FARM',
      name: 'New Poultry Farm',
    });
    expect(org.status).toBe('PENDING');
    expect(org.ownerUserId).toBe(owner.id);
  });

  it('the owner can view their own PENDING farm, but cannot manage it or approve it themselves', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'FARM',
      name: 'Pending Farm',
    });

    // Owner CAN view their own pending farm — this is the fix under test.
    const view = await request(app)
      .get(`/api/v1/organizations/${org.id}`)
      .set(bearer(owner.accessToken));
    expect(view.status).toBe(200);
    expect(view.body.data.status).toBe('PENDING');

    // But restricted operational routes stay blocked while PENDING (scope of
    // the fix is narrow — only the read route was relaxed for the owner).
    const members = await request(app)
      .get(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken));
    expect(members.status).toBe(403);
    expect(members.body.error.code).toBe('ORGANIZATION_NOT_ACTIVE');

    // The owner cannot approve their own farm — that's an admin-only route.
    const selfApprove = await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/approve`)
      .set(bearer(owner.accessToken));
    expect(selfApprove.status).toBe(403);

    // An authorized admin can.
    const approve = await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('ACTIVE');
  });

  it('a random user cannot view someone else’s pending farm', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'FARM',
      name: 'Private Farm',
    });

    const res = await request(app)
      .get(`/api/v1/organizations/${org.id}`)
      .set(bearer(stranger.accessToken));
    expect(res.status).toBe(403);
  });
});
