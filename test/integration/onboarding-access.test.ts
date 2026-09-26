import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { JwtConnectionAuthenticator } from '../../src/modules/chat/realtime/jwt-connection-authenticator.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  extractVerificationCode,
  registerAdmin,
  registerUser,
  seedStorageObject,
  uniqueEmail,
  verifyEmail,
} from '../helpers/factories.js';

/**
 * Two onboarding paths, enforced server-side (`accessStateFor` + `authenticate`):
 *   Pet Owner    → register → emailed code → verify → full access
 *   Veterinarian → register (no email code) → pending-approval gate → admin approves → full access
 */
const storage = new InMemoryObjectStorage(null);
const { app, container } = buildTestApp({ objectStorage: storage });

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  storage.clear();
});
afterAll(() => closeTestDb());

const PASSWORD = 'correct-horse-battery-staple';
const api = (p: string): string => `/api/v1${p}`;

/** Normal (non-onboarding) APIs across modules — none may be reachable while gated. */
const PROTECTED_CALLS: Array<{ method: 'get' | 'post'; path: string; body?: object }> = [
  { method: 'get', path: '/vet-courses' },
  { method: 'get', path: '/vet-jobs/offers' },
  { method: 'get', path: '/vet-services/listings' },
  { method: 'get', path: '/consultations' },
  { method: 'get', path: '/conversations' },
  { method: 'get', path: '/notifications' },
  { method: 'get', path: '/organizations' },
  { method: 'get', path: '/animals' },
  { method: 'post', path: '/organizations', body: { type: 'CLINIC', name: 'Bypass Clinic' } },
];

async function registerAs(
  accountType: 'PET_OWNER' | 'VETERINARIAN',
  email = uniqueEmail(accountType.toLowerCase()),
) {
  const res = await request(app).post(api('/auth/register')).send({
    email,
    password: PASSWORD,
    firstName: 'Onboard',
    lastName: 'Tester',
    phone: '+9647700000001',
    accountType,
  });
  expect(res.status).toBe(201);
  return {
    email,
    res,
    token: res.body.data.tokens.accessToken as string,
    userId: res.body.data.user.id as string,
  };
}

async function applyWithLicense(token: string): Promise<request.Response> {
  const { storageKey } = await seedStorageObject(
    storage,
    StoragePrefix.veterinarianDocuments,
    Buffer.alloc(100, 1),
    'application/pdf',
  );
  return request(app)
    .post(api('/veterinarians/apply'))
    .set(bearer(token))
    .send({
      documents: [
        { kind: 'LICENSE_OR_ID', storageKey, filename: 'license.pdf', mimeType: 'application/pdf' },
      ],
    });
}

const VALID_COURSE = {
  type: 'SEMINAR',
  title: 'ندوة بعد الموافقة',
  description: 'وصف الندوة بعد الموافقة على الطبيب.',
  organizingBody: 'جهة',
  instructorName: 'د. تجريبي',
  startDate: '2999-01-01',
  endDate: '2999-01-01',
  locationMode: 'ONLINE',
  locationDetails: 'أونلاين',
};

const me = (token: string) => request(app).get(api('/auth/me')).set(bearer(token));
const login = (email: string) =>
  request(app).post(api('/auth/login')).send({ email, password: PASSWORD });

async function expectAllProtectedRejected(
  token: string,
  status: number,
  code: string,
): Promise<void> {
  for (const call of PROTECTED_CALLS) {
    const req = request(app)[call.method](api(call.path)).set(bearer(token));
    const res = call.body ? await req.send(call.body) : await req;
    expect({ path: call.path, status: res.status, code: res.body.error?.code }).toEqual({
      path: call.path,
      status,
      code,
    });
  }
}

describe('Pet Owner onboarding — email verification required', () => {
  it('register → code emailed → protected APIs + login blocked → verify → full access', async () => {
    const { email, res, token } = await registerAs('PET_OWNER');
    expect(res.body.data.user).toMatchObject({
      status: 'PENDING_VERIFICATION',
      registrationType: 'PET_OWNER',
    });
    expect(res.body.data.codeExpiresInSeconds).toBeGreaterThan(0);

    // The registration token only reaches the onboarding allowlist.
    const pendingMe = await me(token);
    expect(pendingMe.status).toBe(200);
    expect(pendingMe.body.data.accessState).toBe('EMAIL_VERIFICATION_REQUIRED');
    await expectAllProtectedRejected(token, 401, 'EMAIL_VERIFICATION_REQUIRED');

    // Logging in before verification issues no tokens.
    const early = await login(email);
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(early.body.data).toBeUndefined();

    // Wrong code is rejected; the real one activates the account.
    const realCode = extractVerificationCode(app, email);
    const wrong = await verifyEmail(app, email, realCode === '000000' ? '111111' : '000000');
    expect(wrong.status).toBe(400);
    const verified = await verifyEmail(app, email, realCode);
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.status).toBe('ACTIVE');

    const fullToken = verified.body.data.tokens.accessToken as string;
    expect((await me(fullToken)).body.data.accessState).toBe('FULL');
    expect((await request(app).get(api('/vet-courses')).set(bearer(fullToken))).status).toBe(200);
    // The earlier registration token is also fully usable now — status is re-read per request.
    expect((await request(app).get(api('/notifications')).set(bearer(token))).status).toBe(200);

    expect((await login(email)).status).toBe(200);
  });

  it('an unverified Pet Owner can still sign out server-side', async () => {
    const { res } = await registerAs('PET_OWNER');
    const logout = await request(app)
      .post(api('/auth/logout'))
      .set(bearer(res.body.data.tokens.accessToken))
      .send({ refreshToken: res.body.data.tokens.refreshToken });
    expect(logout.status).toBe(200);
  });
});

describe('Veterinarian onboarding — no email verification, admin approval required', () => {
  it('register sends NO email code and creates an ACTIVE account gated by approval', async () => {
    const provider = container.emailProvider as unknown as { sent: Array<{ to: string }> };
    const before = provider.sent.length;
    const { email, res, token } = await registerAs('VETERINARIAN');

    expect(res.body.data.user).toMatchObject({
      status: 'ACTIVE',
      registrationType: 'VETERINARIAN',
    });
    expect(res.body.data.codeExpiresInSeconds).toBeNull();
    expect(provider.sent.slice(before).filter((m) => m.to === email)).toHaveLength(0);

    // Email verification never applies: verify-email / resend are no-ops for this account.
    expect((await verifyEmail(app, email, '123456')).status).toBe(400);

    const m = await me(token);
    expect(m.body.data.accessState).toBe('VETERINARIAN_APPROVAL_REQUIRED');
    expect(m.body.data.veterinarian).toMatchObject({ status: 'NOT_APPLIED', approved: false });
  });

  it('full flow: register → apply → PENDING gate (incl. fresh login + refresh) → admin approves → full access', async () => {
    const { email, token, userId } = await registerAs('VETERINARIAN');

    // Onboarding allowlist: documents + application + own status.
    const applied = await applyWithLicense(token);
    expect(applied.status).toBe(201);
    expect(
      (await request(app).get(api('/veterinarians/me/status')).set(bearer(token))).body.data
        .veterinarianStatus,
    ).toBe('PENDING');

    // Direct API calls with the registration token are refused (403, not a session error).
    await expectAllProtectedRejected(token, 403, 'VETERINARIAN_ACCOUNT_PENDING_APPROVAL');

    // A pending vet CAN log in (no email gate) — and that fresh token is gated identically.
    const loggedIn = await login(email);
    expect(loggedIn.status).toBe(200);
    const loginToken = loggedIn.body.data.tokens.accessToken as string;
    expect((await me(loginToken)).body.data.accessState).toBe('VETERINARIAN_APPROVAL_REQUIRED');
    await expectAllProtectedRejected(loginToken, 403, 'VETERINARIAN_ACCOUNT_PENDING_APPROVAL');

    // App restart: refresh works and yields another gated token.
    const refreshed = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: loggedIn.body.data.tokens.refreshToken });
    expect(refreshed.status).toBe(200);
    const refreshedToken = refreshed.body.data.tokens.accessToken as string;
    const blocked = await request(app).get(api('/vet-courses')).set(bearer(refreshedToken));
    expect(blocked.status).toBe(403);

    // Admin sees it in the AdminVetApplicationsScreen queue, with documents.
    const admin = await registerAdmin(app);
    const queue = await request(app)
      .get(api('/admin/veterinarians/pending'))
      .set(bearer(admin.accessToken));
    const entry = queue.body.data.find((a: { userId: string }) => a.userId === userId);
    expect(entry).toBeTruthy();
    expect(entry.documents).toHaveLength(1);
    expect(entry.documents[0].downloadUrl).toBeTruthy();

    // The applicant cannot approve themselves.
    expect(
      (
        await request(app)
          .post(api(`/admin/veterinarians/${userId}/approve`))
          .set(bearer(token))
      ).status,
    ).toBe(403);

    const approve = await request(app)
      .post(api(`/admin/veterinarians/${userId}/approve`))
      .set(bearer(admin.accessToken));
    expect(approve.status).toBe(200);

    // Immediately effective for EVERY existing token — no re-login needed.
    for (const t of [token, loginToken, refreshedToken]) {
      const after = await me(t);
      expect(after.body.data.accessState).toBe('FULL');
      expect(after.body.data.veterinarian).toMatchObject({ status: 'APPROVED', approved: true });
      expect(after.body.data.roles).toContain('VETERINARIAN');
      expect((await request(app).get(api('/vet-courses')).set(bearer(t))).status).toBe(200);
    }
    // …and veterinarian-only RBAC now passes (creating a course requires an approved vet).
    const course = await request(app)
      .post(api('/vet-courses'))
      .set(bearer(token))
      .send(VALID_COURSE);
    expect(course.status).toBe(201);
  });

  it('a REJECTED veterinarian stays blocked, sees the rejection, and may re-apply', async () => {
    const { token, userId } = await registerAs('VETERINARIAN');
    await applyWithLicense(token);
    const admin = await registerAdmin(app);
    const reject = await request(app)
      .post(api(`/admin/veterinarians/${userId}/reject`))
      .set(bearer(admin.accessToken))
      .send({ reason: 'الترخيص غير واضح' });
    expect(reject.status).toBe(200);

    expect((await me(token)).body.data.accessState).toBe('VETERINARIAN_APPROVAL_REQUIRED');
    await expectAllProtectedRejected(token, 403, 'VETERINARIAN_ACCOUNT_PENDING_APPROVAL');

    const status = await request(app).get(api('/veterinarians/me/status')).set(bearer(token));
    expect(status.body.data.veterinarianStatus).toBe('REJECTED');
    expect(status.body.data.application.decisionReason).toBe('الترخيص غير واضح');

    // Re-applying is on the onboarding allowlist; it goes back to PENDING (still gated).
    const reapply = await applyWithLicense(token);
    expect(reapply.status).toBe(201);
    expect((await me(token)).body.data.accessState).toBe('VETERINARIAN_APPROVAL_REQUIRED');
  });

  it('a gated veterinarian cannot open a realtime (chat) connection; approval lifts it', async () => {
    const { token, userId } = await registerAs('VETERINARIAN');
    const socketAuth = new JwtConnectionAuthenticator({
      tokens: container.tokenService,
      users: container.userService,
      roles: container.roleRepository,
      logger: container.logger,
    });
    const handshake = { headers: { authorization: `Bearer ${token}` }, query: {} };

    await expect(socketAuth.authenticate(handshake as never)).rejects.toThrow(
      /veterinarian_approval_required/,
    );

    await getTestDb()('users').where({ id: userId }).update({ veterinarian_status: 'APPROVED' });
    await expect(socketAuth.authenticate(handshake as never)).resolves.toMatchObject({ userId });
  });

  it('a gated veterinarian can sign out (logout + logout-all)', async () => {
    const { res } = await registerAs('VETERINARIAN');
    const t = res.body.data.tokens;
    expect(
      (
        await request(app)
          .post(api('/auth/logout'))
          .set(bearer(t.accessToken))
          .send({ refreshToken: t.refreshToken })
      ).status,
    ).toBe(200);
    const again = await request(app)
      .post(api('/auth/refresh'))
      .send({ refreshToken: t.refreshToken });
    expect(again.status).toBe(401);
  });
});

describe('Existing Pet Owners applying in-app are NOT locked out', () => {
  it('a verified Pet Owner with a PENDING veterinarian application keeps full Pet Owner access', async () => {
    const owner = await registerUser(app);
    const applied = await applyWithLicense(owner.accessToken);
    expect(applied.status).toBe(201);

    const m = await me(owner.accessToken);
    expect(m.body.data.accessState).toBe('FULL');
    expect(m.body.data.veterinarian.status).toBe('PENDING');
    expect(
      (await request(app).get(api('/notifications')).set(bearer(owner.accessToken))).status,
    ).toBe(200);

    // …but still gets no veterinarian-only capability until approved.
    const course = await request(app)
      .post(api('/vet-courses'))
      .set(bearer(owner.accessToken))
      .send(VALID_COURSE);
    expect(course.status).toBe(403);
    expect(course.body.error.code).toBe('PERMISSION_DENIED');
  });
});
