import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, loginUser, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('PATCH /users/me — own profile edit', () => {
  it('updates the allow-listed fields and returns the safe profile', async () => {
    const u = await registerUser(app);
    const res = await request(app).patch('/api/v1/users/me').set(bearer(u.accessToken)).send({
      firstName: 'زهير',
      lastName: 'جميل',
      phone: '+964 777 756 4666',
      whatsapp: '+964 777 756 4666',
      country: 'IQ',
      governorate: 'بغداد',
      specialization: 'طبيب بيطري عام',
      bio: 'طبيب بيطري مختص في صحة الحيوانات ورعايتها.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: u.id,
      email: u.email,
      firstName: 'زهير',
      whatsapp: '+964 777 756 4666',
      governorate: 'بغداد',
      bio: 'طبيب بيطري مختص في صحة الحيوانات ورعايتها.',
    });
    expect(res.body.data).not.toHaveProperty('passwordHash');

    const me = await request(app).get('/api/v1/auth/me').set(bearer(u.accessToken));
    expect(me.body.data.user.bio).toBe('طبيب بيطري مختص في صحة الحيوانات ورعايتها.');

    // clearing the bio stores null
    const cleared = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(u.accessToken))
      .send({ bio: '' });
    expect(cleared.body.data.bio).toBeNull();
  });

  it('rejects protected / unknown fields and invalid values', async () => {
    const u = await registerUser(app);
    for (const body of [
      { email: 'new@example.com' },
      { status: 'ACTIVE' },
      { veterinarianStatus: 'APPROVED' },
      { password: 'another-password-123' },
      {},
      { whatsapp: 'not a phone' },
      { bio: 'x'.repeat(1001) },
    ]) {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set(bearer(u.accessToken))
        .send(body);
      expect(res.status).toBe(422);
    }
    const badGov = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(u.accessToken))
      .send({ country: 'IQ', governorate: 'Atlantis' });
    expect(badGov.status).toBeGreaterThanOrEqual(400);
    expect(badGov.status).toBeLessThan(500);
    expect((await request(app).patch('/api/v1/users/me').send({ firstName: 'x' })).status).toBe(
      401,
    );
  });
});

describe('POST /auth/change-password', () => {
  it('verifies the current password, rotates sessions and never echoes passwords', async () => {
    const u = await registerUser(app);
    const other = await loginUser(app, u.email, u.password);

    const wrong = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(u.accessToken))
      .send({ currentPassword: 'definitely-wrong-pw', newPassword: 'brand-new-password-1' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');

    const same = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(u.accessToken))
      .send({ currentPassword: u.password, newPassword: u.password });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('PASSWORD_UNCHANGED');

    const weak = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(u.accessToken))
      .send({ currentPassword: u.password, newPassword: 'short' });
    expect(weak.status).toBe(422);

    const ok = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(u.accessToken))
      .send({ currentPassword: u.password, newPassword: 'brand-new-password-1' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.success).toBe(true);
    expect(ok.body.data.tokens.accessToken).toBeTypeOf('string');
    expect(ok.body.data.tokens.refreshToken).toBeTypeOf('string');
    expect(JSON.stringify(ok.body)).not.toContain('brand-new-password-1');
    expect(JSON.stringify(ok.body)).not.toContain(u.password);

    // other devices are signed out; the fresh pair keeps this device signed in
    const staleRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: other.refreshToken });
    expect(staleRefresh.status).toBe(401);
    const freshRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: ok.body.data.tokens.refreshToken });
    expect(freshRefresh.status).toBe(200);

    // old password no longer works, new one does
    expect((await loginUser(app, u.email, u.password)).status).toBe(401);
    expect((await loginUser(app, u.email, 'brand-new-password-1')).status).toBe(200);

    expect(
      (
        await request(app)
          .post('/api/v1/auth/change-password')
          .send({ currentPassword: 'x', newPassword: 'brand-new-password-2' })
      ).status,
    ).toBe(401);
  });
});
