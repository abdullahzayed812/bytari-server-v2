import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/**
 * Generalized counterpart of `farm-subscription*.test.ts` — VETERINARY_OFFICE / CLINIC now
 * reuse `FarmSubscriptionService` via the new `/organizations/:id/subscription...` routes
 * (Veterinary Office Dashboard spec §3). FARM keeps its own `/farm/subscription...` path
 * unchanged (covered by the existing farm tests, not re-verified here).
 */
function setSubscription(actorToken: string, organizationId: string) {
  return request(app)
    .post(`/api/v1/organizations/${organizationId}/subscription`)
    .set(bearer(actorToken))
    .send({ startDate: '2026-01-01', endDate: '2099-01-01' });
}

async function getOrg(actorToken: string, organizationId: string) {
  const res = await request(app)
    .get(`/api/v1/organizations/${organizationId}`)
    .set(bearer(actorToken));
  return res.body.data;
}

for (const orgType of ['VETERINARY_OFFICE', 'CLINIC'] as const) {
  describe(`${orgType} subscription — reuses the Farm subscription infrastructure`, () => {
    it('admin sets a future-dated subscription — reads back ACTIVE, separate from approval status', async () => {
      const admin = await registerAdmin(app);
      const owner = await registerApprovedVet(app);
      const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type: orgType,
      });

      const set = await setSubscription(admin.accessToken, org.id);
      expect(set.status).toBe(200);

      const details = await getOrg(owner.accessToken, org.id);
      expect(details.details.subscriptionStatus).toBe('ACTIVE');
      expect(details.details.subscriptionEndDate).toBe('2099-01-01');
      expect(details.status).toBe('ACTIVE');
    });

    it('an organization with no subscription set yet reads back NOT_STARTED', async () => {
      const admin = await registerAdmin(app);
      const owner = await registerApprovedVet(app);
      const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type: orgType,
      });

      const details = await getOrg(owner.accessToken, org.id);
      expect(details.details.subscriptionStatus).toBe('NOT_STARTED');
    });

    it('the owner cannot set their own subscription — Admin/Supervisor territory only', async () => {
      const admin = await registerAdmin(app);
      const owner = await registerApprovedVet(app);
      const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type: orgType,
      });

      const res = await setSubscription(owner.accessToken, org.id);
      expect(res.status).toBe(403);
    });

    it('a supervisor explicitly granted farm.subscription.manage can manage this organization', async () => {
      const admin = await registerAdmin(app);
      const owner = await registerApprovedVet(app);
      const supervisor = await registerApprovedVet(app);
      const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type: orgType,
      });

      await assignOrganizationSupervisor(app, owner.accessToken, org.id, {
        userId: supervisor.id,
        permissions: ['farm.subscription.manage'],
      });

      const res = await setSubscription(supervisor.accessToken, org.id);
      expect(res.status).toBe(200);
    });

    it('an unrelated authenticated user cannot manage the subscription', async () => {
      const admin = await registerAdmin(app);
      const owner = await registerApprovedVet(app);
      const stranger = await registerUser(app);
      const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type: orgType,
      });

      const res = await setSubscription(stranger.accessToken, org.id);
      expect(res.status).toBe(403);
    });
  });
}

describe('generic subscription routes reject FARM (keeps exactly one entry point per type)', () => {
  it('400s a FARM organization on the generic /subscription route', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'FARM',
    });

    const res = await setSubscription(admin.accessToken, farm.id);
    expect(res.status).toBe(400);
  });
});
