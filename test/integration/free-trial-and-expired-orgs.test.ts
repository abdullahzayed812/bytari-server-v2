import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const ACTIVE = { startDate: '2026-01-01', endDate: '2099-01-01' };
const EXPIRED = { startDate: '2020-01-01', endDate: '2020-12-31' };

function setSubscription(
  adminToken: string,
  organizationId: string,
  dates: { startDate: string; endDate: string },
) {
  return request(app)
    .post(`/api/v1/organizations/${organizationId}/subscription`)
    .set(bearer(adminToken))
    .send(dates);
}

async function details(token: string, organizationId: string) {
  const res = await request(app).get(`/api/v1/organizations/${organizationId}`).set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data.details as { subscriptionStatus: string; freeTrialEnded: boolean };
}

for (const orgType of ['VETERINARY_OFFICE', 'CLINIC'] as const) {
  describe(`${orgType} — free-trial card ends for good after the first period`, () => {
    it('stays during the first period (incl. date corrections), ends on re-activation after expiry, never returns', async () => {
      const admin = await registerAdmin(app);
      const owner = await registerApprovedVet(app);
      const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type: orgType,
      });
      expect((await details(owner.accessToken, org.id)).freeTrialEnded).toBe(false);

      // First (trial) period — set, then corrected while still running.
      expect((await setSubscription(admin.accessToken, org.id, ACTIVE)).status).toBe(200);
      expect(
        (
          await setSubscription(admin.accessToken, org.id, {
            startDate: '2026-02-01',
            endDate: '2099-02-01',
          })
        ).status,
      ).toBe(200);
      expect((await details(owner.accessToken, org.id)).freeTrialEnded).toBe(false);

      // The first period runs out — still only the trial so far.
      expect((await setSubscription(admin.accessToken, org.id, EXPIRED)).status).toBe(200);
      let d = await details(owner.accessToken, org.id);
      expect(d.subscriptionStatus).toBe('EXPIRED');
      expect(d.freeTrialEnded).toBe(false);

      // Admin activates a new period after the expired one → trial over.
      expect((await setSubscription(admin.accessToken, org.id, ACTIVE)).status).toBe(200);
      d = await details(owner.accessToken, org.id);
      expect(d.subscriptionStatus).toBe('ACTIVE');
      expect(d.freeTrialEnded).toBe(true);

      // Later expiry + renewal: it never comes back.
      await setSubscription(admin.accessToken, org.id, EXPIRED);
      expect((await details(owner.accessToken, org.id)).freeTrialEnded).toBe(true);
      await setSubscription(admin.accessToken, org.id, ACTIVE);
      expect((await details(owner.accessToken, org.id)).freeTrialEnded).toBe(true);
    });
  });

  describe(`${orgType} — admin "expired" tab`, () => {
    it('lists only organizations whose subscription has expired; rows carry the status', async () => {
      const admin = await registerAdmin(app);
      const owner = await registerApprovedVet(app);
      const make = (name: string) =>
        createActiveOrganization(app, owner.accessToken, admin.accessToken, {
          type: orgType,
          name,
        });
      const expired = await make('منتهية');
      const active = await make('فعالة');
      const notStarted = await make('لم تبدأ');
      await setSubscription(admin.accessToken, expired.id, EXPIRED);
      await setSubscription(admin.accessToken, active.id, ACTIVE);

      const list = (query: Record<string, string>) =>
        request(app)
          .get('/api/v1/admin/organizations')
          .query({ type: orgType, ...query })
          .set(bearer(admin.accessToken));

      const expiredTab = await list({ subscriptionStatus: 'EXPIRED' });
      expect(expiredTab.status).toBe(200);
      expect(expiredTab.body.data.map((o: { id: string }) => o.id)).toEqual([expired.id]);
      expect(expiredTab.body.meta.total).toBe(1);

      const all = await list({});
      const statusById = new Map(
        (all.body.data as { id: string; subscriptionStatus: string | null }[]).map((o) => [
          o.id,
          o.subscriptionStatus,
        ]),
      );
      expect(statusById.get(expired.id)).toBe('EXPIRED');
      expect(statusById.get(active.id)).toBe('ACTIVE');
      expect(statusById.get(notStarted.id)).toBe('NOT_STARTED');
    });
  });
}

describe('admin organizations list — subscriptionStatus filter', () => {
  it('matches nothing for a type without a subscription and rejects unknown values', async () => {
    const admin = await registerAdmin(app);
    const none = await request(app)
      .get('/api/v1/admin/organizations')
      .query({ type: 'SYNDICATE', subscriptionStatus: 'EXPIRED' })
      .set(bearer(admin.accessToken));
    expect(none.status).toBe(200);
    expect(none.body.data).toEqual([]);

    const bad = await request(app)
      .get('/api/v1/admin/organizations')
      .query({ subscriptionStatus: 'LAPSED' })
      .set(bearer(admin.accessToken));
    expect(bad.status).toBe(422);
  });
});
