import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  extractVerificationCode,
  loginUser,
  registerUser,
  uniqueEmail,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const NEW_PASSWORD = 'a-brand-new-password-42';

async function requestReset(email: string): Promise<request.Response> {
  return request(app).post('/api/v1/auth/forgot-password').send({ email });
}

async function reset(email: string, code: string, newPassword = NEW_PASSWORD) {
  return request(app).post('/api/v1/auth/reset-password').send({ email, code, newPassword });
}

describe('forgot password → reset password (end to end)', () => {
  it('emails a code, resets the password, invalidates the old one and every session', async () => {
    const user = await registerUser(app);

    const forgot = await requestReset(user.email);
    expect(forgot.status).toBe(200);
    expect(forgot.body.data.codeExpiresInSeconds).toBeGreaterThan(0);

    const code = extractVerificationCode(app, user.email);
    const res = await reset(user.email, code);
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.revokedSessions).toBeGreaterThanOrEqual(1);

    // old password no longer works, new one does
    expect((await loginUser(app, user.email, user.password)).status).toBe(401);
    const relog = await loginUser(app, user.email, NEW_PASSWORD);
    expect(relog.status).toBe(200);

    // the pre-reset refresh token was revoked
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken });
    expect(refresh.status).toBe(401);

    // stored as Argon2id, never plaintext
    const row = (await getTestDb()('users').where({ id: user.id }).first()) as {
      password_hash: string;
    };
    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.password_hash).not.toContain(NEW_PASSWORD);

    // audited
    const audit = await getTestDb()('audit_logs')
      .where({ entity_id: user.id })
      .whereIn('action', ['PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED'])
      .select('action');
    expect(audit.map((a: { action: string }) => a.action).sort()).toEqual([
      'PASSWORD_RESET_COMPLETED',
      'PASSWORD_RESET_REQUESTED',
    ]);
  });

  it('a code is one-time use — replaying it after a successful reset fails', async () => {
    const user = await registerUser(app);
    await requestReset(user.email);
    const code = extractVerificationCode(app, user.email);
    expect((await reset(user.email, code)).status).toBe(200);

    const replay = await reset(user.email, code, 'yet-another-password-99');
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_VERIFICATION_CODE');
    expect((await loginUser(app, user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('concurrent resets with the same code: exactly one succeeds', async () => {
    const user = await registerUser(app);
    await requestReset(user.email);
    const code = extractVerificationCode(app, user.email);
    const results = await Promise.all([
      reset(user.email, code, 'concurrent-password-one'),
      reset(user.email, code, 'concurrent-password-two'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('a wrong code is rejected and does not change the password', async () => {
    const user = await registerUser(app);
    await requestReset(user.email);
    const code = extractVerificationCode(app, user.email);
    const wrong = code === '000000' ? '111111' : '000000';

    const res = await reset(user.email, wrong);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_VERIFICATION_CODE');
    expect((await loginUser(app, user.email, user.password)).status).toBe(200);
  });

  it('locks out after too many wrong attempts (429), even for the right code afterwards', async () => {
    const user = await registerUser(app);
    await requestReset(user.email);
    const code = extractVerificationCode(app, user.email);
    const wrong = code === '000000' ? '111111' : '000000';

    let last: request.Response | null = null;
    for (let i = 0; i < 10; i += 1) {
      last = await reset(user.email, wrong);
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe('TOO_MANY_VERIFICATION_ATTEMPTS');
    expect((await reset(user.email, code)).status).toBe(429);
  });

  it('an unknown email gets the same 200 as a real one (no enumeration) and no email', async () => {
    const email = uniqueEmail('ghost');
    const res = await requestReset(email);
    expect(res.status).toBe(200);
    expect(() => extractVerificationCode(app, email)).toThrow();

    const attempt = await reset(email, '123456');
    expect(attempt.status).toBe(400);
    expect(attempt.body.error.code).toBe('INVALID_VERIFICATION_CODE');
  });

  it('a resend inside the cooldown is rate limited (429)', async () => {
    const user = await registerUser(app);
    expect((await requestReset(user.email)).status).toBe(200);
    const again = await requestReset(user.email);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('RATE_LIMITED');
  });

  it('a password-reset code cannot be used as an email-verification code', async () => {
    const pendingEmail = uniqueEmail();
    await request(app).post('/api/v1/auth/register').send({
      email: pendingEmail,
      password: 'a-very-strong-password',
      firstName: 'P',
      lastName: 'Q',
      phone: '+9647700000001',
    });
    const verificationCode = extractVerificationCode(app, pendingEmail);
    // A PENDING_VERIFICATION account gets no reset code, and the verification
    // code is not accepted as a reset code.
    expect((await requestReset(pendingEmail)).status).toBe(200);
    expect(extractVerificationCode(app, pendingEmail)).toBe(verificationCode);
    const res = await reset(pendingEmail, verificationCode);
    expect(res.status).toBe(400);
  });

  it('validates the new password (422) and the code shape', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code: '12', newPassword: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('existing stateless access tokens live out their short TTL, but can no longer be renewed', async () => {
    const user = await registerUser(app);
    await requestReset(user.email);
    await reset(user.email, extractVerificationCode(app, user.email));
    // Access tokens are stateless JWTs (15 min, ARCHITECTURE §8.2) — same as
    // logout-all, revocation cuts off the refresh path, not the live token.
    const me = await request(app).get('/api/v1/auth/me').set(bearer(user.accessToken));
    expect(me.status).toBe(200);
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken });
    expect(refresh.status).toBe(401);
  });
});
