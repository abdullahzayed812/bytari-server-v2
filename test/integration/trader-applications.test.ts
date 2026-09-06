import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  approveTraderAsAdmin,
  bearer,
  rejectTraderAsAdmin,
  registerAdmin,
  registerUser,
  submitTraderRegistration,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function principalFor(token: string) {
  const verified = await container.tokenService.verifyAccessToken(token);
  const user = await container.userService.getById(verified.userId);
  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    veterinarianStatus: user.veterinarianStatus,
    traderStatus: user.traderStatus,
    roleKeys: await container.roleRepository.getRoleKeysForUser(user.id),
    sessionId: verified.sessionId,
  };
}

describe('trader registration workflow', () => {
  it('register → PENDING, visible via GET /traders/me', async () => {
    const u = await registerUser(app);
    const res = await submitTraderRegistration(app, u.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data?.status).toBe('PENDING');

    const me = await request(app).get('/api/v1/traders/me').set(bearer(u.accessToken));
    expect(me.body.data.traderStatus).toBe('PENDING');
    expect(me.body.data.profile.status).toBe('PENDING');
  });

  it('re-registering while PENDING is a 409', async () => {
    const u = await registerUser(app);
    await submitTraderRegistration(app, u.accessToken);
    const again = await submitTraderRegistration(app, u.accessToken);
    expect(again.status).toBe(409);
  });

  it('registration requires termsAccepted = true (422)', async () => {
    const u = await registerUser(app);
    const res = await submitTraderRegistration(app, u.accessToken, { termsAccepted: false });
    expect(res.status).toBe(422);
  });

  it('approval sets APPROVED, and gates trader-only authz correctly', async () => {
    const u = await registerUser(app);
    await submitTraderRegistration(app, u.accessToken);

    const before = await principalFor(u.accessToken);
    expect(container.authorizationService.isApprovedTrader(before)).toBe(false);
    expect(() => container.authorizationService.assertApprovedTrader(before)).toThrow();

    const admin = await registerAdmin(app);
    const approve = await approveTraderAsAdmin(app, admin.accessToken, u.id);
    expect(approve.status).toBe(200);
    expect(approve.body.data?.status).toBe('APPROVED');

    const after = await principalFor(u.accessToken);
    expect(after.traderStatus).toBe('APPROVED');
    // Deliberately no role grant (unlike veterinarian) — pure status gate.
    expect(after.roleKeys).not.toContain('TRADER');
    expect(container.authorizationService.isApprovedTrader(after)).toBe(true);
    expect(() => container.authorizationService.assertApprovedTrader(after)).not.toThrow();
  });

  it('rejection sets REJECTED with a reason; the user may re-apply into the SAME profile row', async () => {
    const u = await registerUser(app);
    const first = await submitTraderRegistration(app, u.accessToken);
    const firstProfileId = first.body.data.id as string;
    const admin = await registerAdmin(app);

    const reject = await rejectTraderAsAdmin(app, admin.accessToken, u.id, 'missing phone proof');
    expect(reject.status).toBe(200);
    expect(reject.body.data?.status).toBe('REJECTED');
    expect(reject.body.data?.decisionReason).toBe('missing phone proof');

    const me = await request(app).get('/api/v1/traders/me').set(bearer(u.accessToken));
    expect(me.body.data.traderStatus).toBe('REJECTED');

    const reapply = await submitTraderRegistration(app, u.accessToken, {
      displayName: 'اسم محدث للتاجر',
    });
    expect(reapply.status).toBe(201);
    expect(reapply.body.data.status).toBe('PENDING');
    // Reapply overwrites the SAME row in place (unlike the veterinarian
    // applications-history table) — the id never changes.
    expect(reapply.body.data.id).toBe(firstProfileId);
    expect(reapply.body.data.displayName).toBe('اسم محدث للتاجر');
  });

  it('reject requires a reason (422)', async () => {
    const u = await registerUser(app);
    await submitTraderRegistration(app, u.accessToken);
    const admin = await registerAdmin(app);
    const res = await request(app)
      .post(`/api/v1/admin/traders/${u.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({});
    expect(res.status).toBe(422);
  });

  it('an admin cannot approve or reject their own registration', async () => {
    const admin = await registerAdmin(app);
    await submitTraderRegistration(app, admin.accessToken);
    const approve = await approveTraderAsAdmin(app, admin.accessToken, admin.id);
    expect(approve.status).toBe(403);
    const reject = await rejectTraderAsAdmin(app, admin.accessToken, admin.id);
    expect(reject.status).toBe(403);
  });

  it('a non-privileged user cannot approve registrations', async () => {
    const u = await registerUser(app);
    const other = await registerUser(app);
    await submitTraderRegistration(app, u.accessToken);
    const res = await approveTraderAsAdmin(app, other.accessToken, u.id);
    expect(res.status).toBe(403);
  });

  it('suspend an approved trader, then reactivate', async () => {
    const u = await registerUser(app);
    await submitTraderRegistration(app, u.accessToken);
    const admin = await registerAdmin(app);
    await approveTraderAsAdmin(app, admin.accessToken, u.id);

    const suspend = await request(app)
      .post(`/api/v1/admin/traders/${u.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'complaint under review' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.status).toBe('SUSPENDED');

    let after = await principalFor(u.accessToken);
    expect(after.traderStatus).toBe('SUSPENDED');
    expect(container.authorizationService.isApprovedTrader(after)).toBe(false);

    // A suspended trader cannot re-register to escape suspension.
    const reRegister = await submitTraderRegistration(app, u.accessToken);
    expect(reRegister.status).toBe(409);

    const reactivate = await request(app)
      .post(`/api/v1/admin/traders/${u.id}/reactivate`)
      .set(bearer(admin.accessToken));
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.data.status).toBe('APPROVED');

    after = await principalFor(u.accessToken);
    expect(after.traderStatus).toBe('APPROVED');
  });

  it('privilege-escalation regression: client-supplied status/decidedBy have zero effect', async () => {
    const u = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/traders/register')
      .set(bearer(u.accessToken))
      .send({
        displayName: 'تاجر تجريبي',
        traderType: 'WHOLESALE',
        governorate: 'بغداد',
        phone: '+9647701234567',
        termsAccepted: true,
        status: 'APPROVED',
        decidedBy: u.id,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.decidedBy).toBeNull();

    const row = await getTestDb()('users').where({ id: u.id }).first();
    expect(row.trader_status).toBe('PENDING');
  });

  it('admin list + filter by status', async () => {
    const u = await registerUser(app);
    await submitTraderRegistration(app, u.accessToken);
    const admin = await registerAdmin(app);

    const pending = await request(app)
      .get('/api/v1/admin/traders?status=PENDING')
      .set(bearer(admin.accessToken));
    expect(pending.status).toBe(200);
    expect(pending.body.data.some((t: { userId: string }) => t.userId === u.id)).toBe(true);

    const approved = await request(app)
      .get('/api/v1/admin/traders?status=APPROVED')
      .set(bearer(admin.accessToken));
    expect(approved.body.data.some((t: { userId: string }) => t.userId === u.id)).toBe(false);
  });
});
