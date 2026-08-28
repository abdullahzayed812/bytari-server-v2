import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('system supervisor assignments', () => {
  it('an admin assigns, lists, and deactivates an assignment', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);

    const assign = await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: u.id, domain: 'CONSULTATION' });
    expect(assign.status).toBe(201);
    expect(assign.body.data).toMatchObject({
      userId: u.id,
      domain: 'CONSULTATION',
      status: 'ACTIVE',
    });
    const assignmentId = assign.body.data.id as string;

    const list = await request(app)
      .get('/api/v1/admin/supervisors?domain=CONSULTATION')
      .set(bearer(admin.accessToken));
    expect(list.body.data.map((a: { id: string }) => a.id)).toContain(assignmentId);

    // reflected in the user's own context
    const me = await request(app).get('/api/v1/auth/me').set(bearer(u.accessToken));
    expect(me.body.data.supervisorDomains).toEqual(['CONSULTATION']);

    const remove = await request(app)
      .delete(`/api/v1/admin/supervisors/${assignmentId}`)
      .set(bearer(admin.accessToken));
    expect(remove.status).toBe(200);
    expect(remove.body.data.status).toBe('INACTIVE');

    const me2 = await request(app).get('/api/v1/auth/me').set(bearer(u.accessToken));
    expect(me2.body.data.supervisorDomains).toEqual([]);
  });

  it('a user may supervise multiple domains; the assignment is not a role', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    for (const domain of ['CONSULTATION', 'INQUIRY', 'CONTENT']) {
      await request(app)
        .post('/api/v1/admin/supervisors')
        .set(bearer(admin.accessToken))
        .send({ userId: u.id, domain })
        .expect(201);
    }
    const me = await request(app).get('/api/v1/auth/me').set(bearer(u.accessToken));
    expect(me.body.data.supervisorDomains.sort()).toEqual(['CONSULTATION', 'CONTENT', 'INQUIRY']);
    expect(me.body.data.roles).toEqual(['PET_OWNER']); // primary role unchanged
  });

  it('rejects an invalid domain (422)', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: u.id, domain: 'NONSENSE' });
    expect(res.status).toBe(422);
  });

  it('a duplicate active assignment is a 409', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: u.id, domain: 'STORE' })
      .expect(201);
    const dup = await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: u.id, domain: 'STORE' });
    expect(dup.status).toBe(409);
  });

  it('an admin cannot assign a supervisor role to themselves', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: admin.id, domain: 'ANIMAL' });
    expect(res.status).toBe(403);
  });

  it('a non-admin cannot assign or list supervisors', async () => {
    const u = await registerUser(app);
    const target = await registerUser(app);
    await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(u.accessToken))
      .send({ userId: target.id, domain: 'ANIMAL' })
      .expect(403);
    await request(app).get('/api/v1/admin/supervisors').set(bearer(u.accessToken)).expect(403);
  });
});
