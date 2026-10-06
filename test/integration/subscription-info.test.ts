import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  approveTraderAsAdmin,
  bearer,
  createActiveOrganization,
  createSheepFarm,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  submitTraderRegistration,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/subscriptions${p}`;

describe('Subscriptions — free-trial info + "send subscription information"', () => {
  it('GET /info returns the configured free-trial period for every subject', async () => {
    const user = await registerUser(app);
    for (const subject of [
      'CLINIC',
      'VETERINARY_OFFICE',
      'POULTRY_FARM',
      'SHEEP_FARM',
      'CATTLE_FARM',
      'POULTRY_TRADER',
    ]) {
      const res = await request(app)
        .get(api(`/info?subject=${subject}`))
        .set(bearer(user.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ subject, freeTrialDays: expect.any(Number) });
    }
    const bad = await request(app).get(api('/info?subject=X')).set(bearer(user.accessToken));
    expect(bad.status).toBe(422);
    const anon = await request(app).get(api('/info?subject=CLINIC'));
    expect(anon.status).toBe(401);
  });

  it('an office owner sends the info request into a SUPPORT thread; members / strangers / wrong type cannot', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب الرحمة',
    });

    const sent = await request(app)
      .post(api('/info-requests'))
      .set(bearer(owner.accessToken))
      .send({
        subject: 'VETERINARY_OFFICE',
        organizationId: office.id,
        note: 'أريد الباقة السنوية',
      });
    expect(sent.status).toBe(201);
    const threadId = sent.body.data.threadId as string;

    const msgs = await request(app)
      .get(`/api/v1/support-messages/${threadId}/messages`)
      .set(bearer(owner.accessToken));
    expect(msgs.status).toBe(200);
    const body = (msgs.body.data as { body: string }[]).map((m) => m.body).join('\n');
    expect(body).toContain('مكتب الرحمة');
    expect(body).toContain('الفترة المجانية');
    expect(body).toContain('أريد الباقة السنوية');

    // the administration sees it in the support queue
    const adminThread = await request(app)
      .get(`/api/v1/support-messages/${threadId}`)
      .set(bearer(admin.accessToken));
    expect(adminThread.status).toBe(200);

    // a plain STAFF member, a stranger, and a mismatched subject are refused (404, no leak)
    const staff = await registerUser(app);
    await addOrganizationMember(app, owner.accessToken, office.id, {
      userId: staff.id,
      role: 'STAFF',
    });
    const stranger = await registerUser(app);
    for (const token of [staff.accessToken, stranger.accessToken]) {
      const res = await request(app)
        .post(api('/info-requests'))
        .set(bearer(token))
        .send({ subject: 'VETERINARY_OFFICE', organizationId: office.id });
      expect(res.status).toBe(404);
    }
    const wrongType = await request(app)
      .post(api('/info-requests'))
      .set(bearer(owner.accessToken))
      .send({ subject: 'CLINIC', organizationId: office.id });
    expect(wrongType.status).toBe(404);
    const missingOrg = await request(app)
      .post(api('/info-requests'))
      .set(bearer(owner.accessToken))
      .send({ subject: 'CLINIC' });
    expect(missingOrg.status).toBe(400);
  });

  it('farm owners and registered traders can send; an unregistered user cannot use the trader subject', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createSheepFarm(app, owner.accessToken, admin.accessToken, {
      name: 'حقل النور',
    });
    const farmReq = await request(app)
      .post(api('/info-requests'))
      .set(bearer(owner.accessToken))
      .send({ subject: 'SHEEP_FARM', organizationId: farm.id });
    expect(farmReq.status).toBe(201);

    const trader = await registerUser(app);
    expect((await submitTraderRegistration(app, trader.accessToken)).status).toBe(201);
    await approveTraderAsAdmin(app, admin.accessToken, trader.id);
    const traderReq = await request(app)
      .post(api('/info-requests'))
      .set(bearer(trader.accessToken))
      .send({ subject: 'POULTRY_TRADER' });
    expect(traderReq.status).toBe(201);

    const nobody = await registerUser(app);
    const denied = await request(app)
      .post(api('/info-requests'))
      .set(bearer(nobody.accessToken))
      .send({ subject: 'POULTRY_TRADER' });
    expect(denied.status).toBe(403);
  });
});
