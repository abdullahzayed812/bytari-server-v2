import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
  createOrganization,
  loginUser,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('supervisors — several sections, backend-enforced (403 outside them)', () => {
  it('assigns multiple sections at once and replaces the set on update', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    const set = await request(app)
      .put('/api/v1/admin/supervisors/domains')
      .set(bearer(admin.accessToken))
      .send({ email: sup.email, domains: ['USERS', 'CLINIC', 'VET_COURSES'] });
    expect(set.status).toBe(200);
    expect([...set.body.data.domains].sort()).toEqual(['CLINIC', 'USERS', 'VET_COURSES']);

    const me = await request(app).get('/api/v1/auth/me').set(bearer(sup.accessToken));
    expect([...me.body.data.supervisorDomains].sort()).toEqual(['CLINIC', 'USERS', 'VET_COURSES']);
    expect(me.body.data.permissions).toContain('user.read');
    expect(me.body.data.permissions).toContain('dashboard.admin.read');
    expect(me.body.data.permissions).not.toContain('veterinarian.approve');

    const update = await request(app)
      .put('/api/v1/admin/supervisors/domains')
      .set(bearer(admin.accessToken))
      .send({ userId: sup.id, domains: ['USERS'] });
    expect(update.body.data.domains).toEqual(['USERS']);

    // A supervisor cannot manage supervisors.
    const escalate = await request(app)
      .put('/api/v1/admin/supervisors/domains')
      .set(bearer(sup.accessToken))
      .send({ userId: sup.id, domains: ['USERS', 'VETERINARIANS'] });
    expect(escalate.status).toBe(403);
  });

  it('a USERS supervisor reaches user management but gets 403 on unassigned sections', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await request(app)
      .put('/api/v1/admin/supervisors/domains')
      .set(bearer(admin.accessToken))
      .send({ userId: sup.id, domains: ['USERS'] });
    const t = bearer(sup.accessToken);
    expect((await request(app).get('/api/v1/admin/users').set(t)).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/dashboard/summary').set(t)).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/veterinarians/pending').set(t)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/vet-courses').set(t)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/traders').set(t)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/organizations?type=CLINIC').set(t)).status).toBe(
      403,
    );
  });

  it('organization sections are type-scoped: a CLINIC supervisor approves a clinic, not a farm', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await request(app)
      .put('/api/v1/admin/supervisors/domains')
      .set(bearer(admin.accessToken))
      .send({ userId: sup.id, domains: ['CLINIC'] });
    const token = (await loginUser(app, sup.email, sup.password)).accessToken;
    const owner = await registerApprovedVet(app);
    const clinic = await createOrganization(app, owner.accessToken, {
      type: 'CLINIC',
      name: 'عيادة',
    });
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'مزرعة' });

    const approve = await request(app)
      .post(`/api/v1/admin/organizations/${clinic.id}/approve`)
      .set(bearer(token));
    expect(approve.status).toBe(200);

    const farmStatus = await request(app)
      .post(`/api/v1/admin/organizations/${farm.id}/suspend`)
      .set(bearer(token))
      .send({});
    expect(farmStatus.status).toBe(403);
    expect(
      (await request(app).get('/api/v1/admin/organizations?type=CLINIC').set(bearer(token))).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/v1/admin/organizations?type=FARM').set(bearer(token))).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/admin/organizations/farms').set(bearer(token))).status,
    ).toBe(403);
    // No type filter = every type → not for a type-scoped supervisor.
    expect((await request(app).get('/api/v1/admin/organizations').set(bearer(token))).status).toBe(
      403,
    );
  });
});
