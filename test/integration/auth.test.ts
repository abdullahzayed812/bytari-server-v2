import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, loginUser, registerUser, uniqueEmail } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('POST /auth/register', () => {
  it('creates an ACTIVE user with the PET_OWNER role and returns tokens', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'a-very-strong-password', firstName: 'Sam', lastName: 'Doe' });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      email,
      status: 'ACTIVE',
      veterinarianStatus: 'NOT_APPLIED',
    });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.tokens.accessToken).toBeTypeOf('string');
    expect(res.body.data.tokens.refreshToken).toBeTypeOf('string');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(bearer(res.body.data.tokens.accessToken));
    expect(me.body.data.roles).toEqual(['PET_OWNER']);
  });

  it('stores an Argon2id hash, never the raw password', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'plaintext-secret-123', firstName: 'A', lastName: 'B' });

    const row = (await getTestDb()('users').where({ email }).first()) as { password_hash: string };
    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.password_hash).not.toContain('plaintext-secret-123');
  });

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueEmail();
    const body = { email, password: 'a-very-strong-password', firstName: 'A', lastName: 'B' };
    await request(app).post('/api/v1/auth/register').send(body);
    const res = await request(app).post('/api/v1/auth/register').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects invalid input with 422', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', firstName: '', lastName: 'B' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores a client-supplied role (no privilege escalation)', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'a-very-strong-password',
        firstName: 'A',
        lastName: 'B',
        role: 'ADMIN',
        roles: ['ADMIN'],
        isVeterinarian: true,
      });
    expect(res.status).toBe(201);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(bearer(res.body.data.tokens.accessToken));
    expect(me.body.data.roles).toEqual(['PET_OWNER']);
    expect(me.body.data.isAdmin).toBe(false);
  });
});

describe('POST /auth/login', () => {
  it('succeeds with correct credentials', async () => {
    const u = await registerUser(app);
    const res = await loginUser(app, u.email, u.password);
    expect(res.status).toBe(200);
    expect(res.accessToken).toBeTypeOf('string');
  });

  it('returns 401 INVALID_CREDENTIALS for a wrong password', async () => {
    const u = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'wrong-password-here' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 INVALID_CREDENTIALS for an unknown user (no account enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: 'whatever-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('authentication (access token)', () => {
  it('accepts a valid token', async () => {
    const u = await registerUser(app);
    const res = await request(app).get('/api/v1/auth/me').set(bearer(u.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(u.email);
  });

  it('rejects a missing token with 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects a malformed / tampered token with 401', async () => {
    const u = await registerUser(app);
    const tampered = `${u.accessToken.slice(0, -3)}abc`;
    const res = await request(app).get('/api/v1/auth/me').set(bearer(tampered));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token signed with a different secret', async () => {
    const { SignJWT } = await import('jose');
    const forged = await new SignJWT({ sid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-0000-0000-000000000000')
      .setIssuer('bytari')
      .setAudience('bytari-app')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('an-entirely-different-secret-value-here'));
    const res = await request(app).get('/api/v1/auth/me').set(bearer(forged));
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token; the new one works and the old one does not', async () => {
    const u = await registerUser(app);
    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken });
    expect(first.status).toBe(200);
    const newRefresh = first.body.data.tokens.refreshToken as string;
    expect(newRefresh).not.toBe(u.refreshToken);

    // the rotated token continues the chain
    const second = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: newRefresh });
    expect(second.status).toBe(200);

    // the original token is dead
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('detects replay: reusing a revoked token revokes the whole chain', async () => {
    const u = await registerUser(app);
    const r1 = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken });
    const t2 = r1.body.data.tokens.refreshToken as string;
    // replay the original (already rotated) token
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken })
      .expect(401);
    // the legitimate successor is now also dead
    const afterReplay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t2 });
    expect(afterReplay.status).toBe(401);

    const active = await getTestDb()('refresh_sessions')
      .where({ user_id: u.id })
      .whereNull('revoked_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    expect(Number(active?.count)).toBe(0);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'x'.repeat(43) });
    expect(res.status).toBe(401);
  });
});

describe('sessions & logout', () => {
  it('supports multiple independent sessions per user', async () => {
    const u = await registerUser(app);
    const s2 = await loginUser(app, u.email, u.password);

    // revoke session 1 only
    await request(app)
      .post('/api/v1/auth/logout')
      .set(bearer(u.accessToken))
      .send({ refreshToken: u.refreshToken })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken })
      .expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s2.refreshToken })
      .expect(200);
  });

  it('logout-all revokes every session', async () => {
    const u = await registerUser(app);
    const s2 = await loginUser(app, u.email, u.password);

    const res = await request(app).post('/api/v1/auth/logout-all').set(bearer(u.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.revokedSessions).toBeGreaterThanOrEqual(2);

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken })
      .expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s2.refreshToken })
      .expect(401);
  });
});
