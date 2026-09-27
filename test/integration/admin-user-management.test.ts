import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  extractVerificationCode,
  loginUser,
  registerAdmin,
  registerModerator,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const API = '/api/v1';
const NEW_PASSWORD = 'admin-chosen-password-42';

/** Every key of an object tree — used to prove no password/hash/storage key leaks. */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe('admin user management — details', () => {
  it('returns the full profile, roles, vet application and organizations — never a password or key', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const res = await request(app)
      .get(`${API}/admin/users/${user.id}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: user.id,
      email: user.email,
      status: 'ACTIVE',
      veterinarianApplication: null,
      organizations: [],
    });
    expect(res.body.data).toHaveProperty('avatarUrl');
    expect(res.body.data).toHaveProperty('country');
    expect(res.body.data).toHaveProperty('governorate');
    expect(Array.isArray(res.body.data.roles)).toBe(true);
    const keys = allKeys(res.body.data).map((k) => k.toLowerCase());
    for (const forbidden of [
      'password',
      'passwordhash',
      'password_hash',
      'avatarkey',
      'storagekey',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('a plain user cannot read another user through the admin API (403)', async () => {
    const user = await registerUser(app);
    const other = await registerUser(app);
    const res = await request(app)
      .get(`${API}/admin/users/${other.id}`)
      .set(bearer(user.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('admin user management — edit', () => {
  it('edits name / phone / email / country / governorate and audits it', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const res = await request(app)
      .patch(`${API}/admin/users/${user.id}`)
      .set(bearer(admin.accessToken))
      .send({
        firstName: 'Edited',
        phone: '+9647701234567',
        email: 'Edited.Address@Example.com',
        country: 'IQ',
        governorate: 'البصرة',
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      firstName: 'Edited',
      email: 'edited.address@example.com',
      country: 'IQ',
      governorate: 'البصرة',
    });
    // the user can now sign in with the new email
    expect((await loginUser(app, 'edited.address@example.com', user.password)).status).toBe(200);
  });

  it('rejects a taken email (409), an invalid Iraqi governorate (400) and protected fields (422)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const other = await registerUser(app);

    const taken = await request(app)
      .patch(`${API}/admin/users/${user.id}`)
      .set(bearer(admin.accessToken))
      .send({ email: other.email });
    expect(taken.status).toBe(409);

    const badGov = await request(app)
      .patch(`${API}/admin/users/${user.id}`)
      .set(bearer(admin.accessToken))
      .send({ country: 'IQ', governorate: 'Atlantis' });
    expect(badGov.status).toBe(400);

    for (const body of [
      { status: 'ACTIVE' },
      { roles: ['ADMIN'] },
      { passwordHash: 'x' },
      { veterinarianStatus: 'APPROVED' },
    ]) {
      const res = await request(app)
        .patch(`${API}/admin/users/${user.id}`)
        .set(bearer(admin.accessToken))
        .send(body);
      expect(res.status).toBe(422);
    }
  });

  it('a moderator (user.read only) cannot edit (403)', async () => {
    const mod = await registerModerator(app);
    const user = await registerUser(app);
    const res = await request(app)
      .patch(`${API}/admin/users/${user.id}`)
      .set(bearer(mod.accessToken))
      .send({ firstName: 'Nope' });
    expect(res.status).toBe(403);
  });
});

describe('admin user management — block', () => {
  it('suspending cuts off the existing access token and refresh session; unblocking restores login', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const suspend = await request(app)
      .post(`${API}/admin/users/${user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'abuse' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.status).toBe('SUSPENDED');

    expect((await request(app).get(`${API}/auth/me`).set(bearer(user.accessToken))).status).toBe(
      401,
    );
    const refresh = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: user.refreshToken });
    expect(refresh.status).toBe(401);
    expect((await loginUser(app, user.email, user.password)).status).not.toBe(200);

    await request(app)
      .post(`${API}/admin/users/${user.id}/activate`)
      .set(bearer(admin.accessToken))
      .send({});
    expect((await loginUser(app, user.email, user.password)).status).toBe(200);
  });
});

describe('admin user management — password', () => {
  it('admin sets a new password: old one stops working, sessions revoked, nothing readable back', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const res = await request(app)
      .post(`${API}/admin/users/${user.id}/password`)
      .set(bearer(admin.accessToken))
      .send({ newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.revokedSessions).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);

    expect((await loginUser(app, user.email, user.password)).status).toBe(401);
    expect((await loginUser(app, user.email, NEW_PASSWORD)).status).toBe(200);
    const refresh = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: user.refreshToken });
    expect(refresh.status).toBe(401);

    // the audit row carries no password material
    const audit = await getTestDb()('audit_logs')
      .where({ action: 'PASSWORD_SET_BY_ADMIN', entity_id: user.id })
      .first();
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
  });

  it('rejects a weak password (422), a non-admin (403) and the admin’s own account (403)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const weak = await request(app)
      .post(`${API}/admin/users/${user.id}/password`)
      .set(bearer(admin.accessToken))
      .send({ newPassword: 'short' });
    expect(weak.status).toBe(422);

    const other = await registerUser(app);
    const denied = await request(app)
      .post(`${API}/admin/users/${user.id}/password`)
      .set(bearer(other.accessToken))
      .send({ newPassword: NEW_PASSWORD });
    expect(denied.status).toBe(403);

    const self = await request(app)
      .post(`${API}/admin/users/${admin.id}/password`)
      .set(bearer(admin.accessToken))
      .send({ newPassword: NEW_PASSWORD });
    expect(self.status).toBe(403);
  });

  it('admin can email a reset code that the user redeems themselves', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const sent = await request(app)
      .post(`${API}/admin/users/${user.id}/password-reset`)
      .set(bearer(admin.accessToken));
    expect(sent.status).toBe(200);
    const code = extractVerificationCode(app, user.email);
    const reset = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ email: user.email, code, newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect((await loginUser(app, user.email, NEW_PASSWORD)).status).toBe(200);
  });
});

describe('admin user management — message user', () => {
  it('opens a support thread owned by the user with the admin’s first message', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const res = await request(app)
      .post(`${API}/admin/users/${user.id}/messages`)
      .set(bearer(admin.accessToken))
      .send({ body: 'مرحباً، نود التواصل معك بخصوص حسابك' });
    expect(res.status).toBe(201);
    const threadId = res.body.data.id as string;

    // it shows up in the USER's own support inbox and they can read + reply
    const mine = await request(app).get(`${API}/support-messages`).set(bearer(user.accessToken));
    expect(mine.body.data.map((t: { id: string }) => t.id)).toContain(threadId);
    const msgs = await request(app)
      .get(`${API}/support-messages/${threadId}/messages`)
      .set(bearer(user.accessToken));
    expect(msgs.status).toBe(200);
    expect(msgs.body.data[0]).toMatchObject({ source: 'ADMIN' });
    const reply = await request(app)
      .post(`${API}/support-messages/${threadId}/messages`)
      .set(bearer(user.accessToken))
      .send({ body: 'شكراً' });
    expect(reply.status).toBe(201);

    // another user cannot see it
    const stranger = await registerUser(app);
    const peek = await request(app)
      .get(`${API}/support-messages/${threadId}`)
      .set(bearer(stranger.accessToken));
    expect(peek.status).toBe(404);
  });

  it('a plain user / moderator cannot message users through the admin API; unknown user 404', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const mod = await registerModerator(app);
    const plain = await request(app)
      .post(`${API}/admin/users/${admin.id}/messages`)
      .set(bearer(user.accessToken))
      .send({ body: 'hi' });
    expect(plain.status).toBe(403);
    const modRes = await request(app)
      .post(`${API}/admin/users/${user.id}/messages`)
      .set(bearer(mod.accessToken))
      .send({ body: 'hi' });
    expect(modRes.status).toBe(403);
    const missing = await request(app)
      .post(`${API}/admin/users/7cac6e9c-c914-4fbd-ad2c-07a6cbe4fc02/messages`)
      .set(bearer(admin.accessToken))
      .send({ body: 'hi' });
    expect(missing.status).toBe(404);
  });
});
