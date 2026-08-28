import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerModerator, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('API authorization', () => {
  it('allows a MODERATOR (granted user.read via role) to list users', async () => {
    const mod = await registerModerator(app);
    const res = await request(app).get('/api/v1/admin/users').set(bearer(mod.accessToken));
    expect(res.status).toBe(200);
  });

  it('denies the same MODERATOR from creating a user (no user.create)', async () => {
    const mod = await registerModerator(app);
    const res = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(mod.accessToken))
      .send({ email: 'x@y.test', password: 'a-strong-password-1', firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('denies a plain PET_OWNER from any admin route', async () => {
    const u = await registerUser(app);
    const res = await request(app).get('/api/v1/admin/users').set(bearer(u.accessToken));
    expect(res.status).toBe(403);
  });

  it('ADMIN override: an admin with ZERO permission rows can do everything', async () => {
    const admin = await registerAdmin(app);

    const list = await request(app).get('/api/v1/admin/users').set(bearer(admin.accessToken));
    expect(list.status).toBe(200);

    const create = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        email: `made.${Date.now()}@test.bytari`,
        password: 'a-strong-password-1',
        firstName: 'Made',
        lastName: 'ByAdmin',
      });
    expect(create.status).toBe(201);

    const audit = await request(app).get('/api/v1/admin/audit-logs').set(bearer(admin.accessToken));
    expect(audit.status).toBe(200);
  });

  it('rejects unauthenticated access to protected routes with 401', async () => {
    await request(app).get('/api/v1/admin/users').expect(401);
    await request(app).get('/api/v1/admin/audit-logs').expect(401);
  });
});
