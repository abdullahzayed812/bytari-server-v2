import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  extractVerificationCode,
  registerUser,
  uniqueEmail,
  verifyEmail,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/** Registers a fresh account WITHOUT auto-verifying (unlike `registerUser`). */
async function registerPending(overrides: { email?: string } = {}): Promise<{
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}> {
  const email = overrides.email ?? uniqueEmail();
  const password = 'a-very-strong-password';
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: 'Pending', lastName: 'User', phone: '+9647700000001' });
  if (res.status !== 201) {
    throw new Error(`registerPending failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    email,
    password,
    accessToken: res.body.data.tokens.accessToken as string,
    refreshToken: res.body.data.tokens.refreshToken as string,
  };
}

describe('POST /auth/verify-email', () => {
  it('a wrong code is rejected (400 INVALID_VERIFICATION_CODE) and does not consume the real code', async () => {
    const { email } = await registerPending();
    const wrong = await verifyEmail(app, email, '000000');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_VERIFICATION_CODE');

    // the REAL code still works afterward
    const code = extractVerificationCode(app, email);
    const ok = await verifyEmail(app, email, code);
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.status).toBe('ACTIVE');
  });

  it('an unknown email is rejected exactly like a wrong code (no account-enumeration signal)', async () => {
    const res = await verifyEmail(app, uniqueEmail('ghost'), '123456');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_VERIFICATION_CODE');
  });

  it('an already-ACTIVE account rejects verify-email the same way', async () => {
    const u = await registerUser(app); // auto-verifies
    const res = await verifyEmail(app, u.email, '123456');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_VERIFICATION_CODE');
  });

  it('too many wrong attempts locks the code out (429 TOO_MANY_VERIFICATION_ATTEMPTS), even with the right code', async () => {
    const { email } = await registerPending();
    const code = extractVerificationCode(app, email);

    // Default EMAIL_VERIFICATION_MAX_ATTEMPTS=5 — exhaust it with wrong guesses.
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential attempts, order matters
      const res = await verifyEmail(app, email, '999999');
      if (i < 4) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_VERIFICATION_CODE');
      } else {
        expect(res.status).toBe(429);
        expect(res.body.error.code).toBe('TOO_MANY_VERIFICATION_ATTEMPTS');
      }
    }

    // locked out — even the CORRECT code is now refused.
    const lockedOut = await verifyEmail(app, email, code);
    expect(lockedOut.status).toBe(429);
    expect(lockedOut.body.error.code).toBe('TOO_MANY_VERIFICATION_ATTEMPTS');
  });

  it('verifying with the correct code issues a full, unrestricted session', async () => {
    const { email } = await registerPending();
    const code = extractVerificationCode(app, email);
    const res = await verifyEmail(app, email, code);
    expect(res.status).toBe(200);
    expect(res.body.data.user.status).toBe('ACTIVE');
    expect(res.body.data.tokens.accessToken).toBeTypeOf('string');

    const animals = await request(app)
      .get('/api/v1/animals')
      .set(bearer(res.body.data.tokens.accessToken));
    expect(animals.status).toBe(200); // no longer EMAIL_VERIFICATION_REQUIRED
  });
});

describe('POST /auth/resend-verification', () => {
  it('an unknown email gets a generic 200 (no email is actually sent, no enumeration signal)', async () => {
    const ghost = uniqueEmail('ghost');
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: ghost });
    expect(res.status).toBe(200);
    expect(() => extractVerificationCode(app, ghost)).toThrow();
  });

  it('an already-ACTIVE email also gets a generic 200 with no new code sent', async () => {
    const u = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: u.email });
    expect(res.status).toBe(200);
  });

  it('resending too soon is rate-limited (429) — the cooldown is measured from the last code issued, INCLUDING the one registration itself just sent', async () => {
    const { email } = await registerPending();
    const tooSoon = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('RATE_LIMITED');

    // and a SECOND immediate attempt is still blocked too, obviously.
    const stillTooSoon = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email });
    expect(stillTooSoon.status).toBe(429);
  });
});

describe('login is blocked for an unverified account', () => {
  it('correct credentials, unverified email → 403 EMAIL_VERIFICATION_REQUIRED, NO tokens issued', async () => {
    const { email, password } = await registerPending();
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(res.body.data).toBeUndefined();
  });

  it('a wrong password on an unverified account still gets the generic INVALID_CREDENTIALS (never leaks verification state)', async () => {
    const { email } = await registerPending();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'definitely-the-wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('login succeeds normally once the account is verified', async () => {
    const { email, password } = await registerPending();
    const code = extractVerificationCode(app, email);
    await verifyEmail(app, email, code);

    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.data.user.status).toBe('ACTIVE');
  });
});

describe('an unverified account cannot use normal application functionality', () => {
  it('the registration-time token is rejected on a protected route with 401 EMAIL_VERIFICATION_REQUIRED, not silently allowed', async () => {
    const { accessToken } = await registerPending();
    const res = await request(app).get('/api/v1/animals').set(bearer(accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });

  it('…but CAN reach the small self-service allowlist needed to finish registering', async () => {
    const { accessToken } = await registerPending();

    const me = await request(app).get('/api/v1/auth/me').set(bearer(accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.user.status).toBe('PENDING_VERIFICATION');

    const avatarUpload = await request(app)
      .post('/api/v1/users/me/avatar/upload-url')
      .set(bearer(accessToken))
      .send({ filename: 'me.png', mimeType: 'image/png', size: 1024 });
    expect(avatarUpload.status).toBe(201);
    expect(avatarUpload.body.data.storageKey).toContain('users/avatars/');

    const docUpload = await request(app)
      .post('/api/v1/veterinarians/documents/upload-url')
      .set(bearer(accessToken))
      .send({ kind: 'LICENSE_OR_ID', filename: 'id.png', mimeType: 'image/png', size: 1024 });
    expect(docUpload.status).toBe(201);

    const vetStatus = await request(app)
      .get('/api/v1/veterinarians/me/status')
      .set(bearer(accessToken));
    expect(vetStatus.status).toBe(200);
  });

  it('a refresh keeps working pre-verification (the registration session can outlive one access-token TTL)', async () => {
    const { refreshToken } = await registerPending();
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeTypeOf('string');

    // the ROTATED token is still scoped the same way — still not a normal session.
    const animals = await request(app)
      .get('/api/v1/animals')
      .set(bearer(res.body.data.tokens.accessToken as string));
    expect(animals.status).toBe(401);
    expect(animals.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });
});

/**
 * A separate, short-lived app whose `EMAIL_VERIFICATION_CODE_TTL_SECONDS` /
 * `_RESEND_COOLDOWN_SECONDS` are overridden to ~1s BEFORE `buildTestApp()`
 * builds it (`loadConfig()` re-reads `process.env` on every call — it is
 * NOT memoised the way `getConfig()` is — so this is a real, not mocked,
 * config value, just a small one). Restored after so it never bleeds into
 * any other file in the same worker.
 */
describe('expiry & resend-cooldown — real elapsed time, short TTLs', () => {
  const originalTtl = process.env.EMAIL_VERIFICATION_CODE_TTL_SECONDS;
  const originalCooldown = process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS;

  beforeAll(() => {
    process.env.EMAIL_VERIFICATION_CODE_TTL_SECONDS = '1';
    process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = '1';
  });
  afterAll(() => {
    if (originalTtl === undefined) delete process.env.EMAIL_VERIFICATION_CODE_TTL_SECONDS;
    else process.env.EMAIL_VERIFICATION_CODE_TTL_SECONDS = originalTtl;
    if (originalCooldown === undefined) delete process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS;
    else process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = originalCooldown;
  });

  it('an expired code is rejected (400 VERIFICATION_CODE_EXPIRED), distinctly from a wrong code', async () => {
    const { app: shortApp } = buildTestApp();
    const email = uniqueEmail();
    const res = await request(shortApp)
      .post('/api/v1/auth/register')
      .send({ email, password: 'a-very-strong-password', firstName: 'A', lastName: 'B', phone: '+9647700000001' });
    expect(res.status).toBe(201);
    const code = extractVerificationCode(shortApp, email);

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const expired = await verifyEmail(shortApp, email, code);
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('VERIFICATION_CODE_EXPIRED');
  });

  it('a resend after the cooldown elapses succeeds', async () => {
    const { app: shortApp } = buildTestApp();
    const email = uniqueEmail();
    await request(shortApp)
      .post('/api/v1/auth/register')
      .send({ email, password: 'a-very-strong-password', firstName: 'A', lastName: 'B', phone: '+9647700000001' });

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const resend = await request(shortApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email });
    expect(resend.status).toBe(200);

    const code = extractVerificationCode(shortApp, email);
    const verified = await verifyEmail(shortApp, email, code);
    expect(verified.status).toBe(200);
  });

  it('a resend replaces the outstanding code — the OLD code stops working, the NEW one works', async () => {
    const { app: shortApp } = buildTestApp();
    const email = uniqueEmail();
    await request(shortApp)
      .post('/api/v1/auth/register')
      .send({ email, password: 'a-very-strong-password', firstName: 'A', lastName: 'B', phone: '+9647700000001' });
    const firstCode = extractVerificationCode(shortApp, email);

    await new Promise((resolve) => setTimeout(resolve, 1_200)); // clear the resend cooldown

    const resend = await request(shortApp)
      .post('/api/v1/auth/resend-verification')
      .send({ email });
    expect(resend.status).toBe(200);
    expect(resend.body.data.codeExpiresInSeconds).toBeGreaterThan(0);

    const secondCode = extractVerificationCode(shortApp, email);
    expect(secondCode).not.toBe(firstCode);

    const withOld = await verifyEmail(shortApp, email, firstCode);
    expect(withOld.status).toBe(400);
    expect(withOld.body.error.code).toBe('INVALID_VERIFICATION_CODE');

    const withNew = await verifyEmail(shortApp, email, secondCode);
    expect(withNew.status).toBe(200);
  });
});
