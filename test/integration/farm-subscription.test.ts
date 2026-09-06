import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  approveOrganization,
  bearer,
  createFarm,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  requestFarmRenewal,
  setFarmSubscriptionAsAdmin,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function getOrg(actorToken: string, organizationId: string) {
  const res = await request(app)
    .get(`/api/v1/organizations/${organizationId}`)
    .set(bearer(actorToken));
  return res.body.data;
}

describe('farm subscription — admin-controlled period, backend-computed status', () => {
  it('admin sets a future-dated subscription — the farm reads back ACTIVE with the correct end date', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const set = await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2026-01-01',
      endDate: '2099-01-01',
    });
    expect(set.status).toBe(200);

    const org = await getOrg(owner.accessToken, farm.id);
    expect(org.details.subscriptionStatus).toBe('ACTIVE');
    expect(org.details.subscriptionEndDate).toBe('2099-01-01');
    // Approval status and subscription status are tracked separately.
    expect(org.status).toBe('ACTIVE');
  });

  it('a subscription with an end date in the past reads back EXPIRED', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });

    const org = await getOrg(owner.accessToken, farm.id);
    expect(org.details.subscriptionStatus).toBe('EXPIRED');
  });

  it('a farm with no subscription set yet reads back NOT_STARTED', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    // Built directly — `createFarm` sets an active subscription by default.
    const rawOrg = await createOrganization(app, owner.accessToken, { type: 'FARM' });
    await approveOrganization(app, admin.accessToken, rawOrg.id);

    const org = await getOrg(owner.accessToken, rawOrg.id);
    expect(org.details.subscriptionStatus).toBe('NOT_STARTED');
  });

  it('non-admin cannot set a farm subscription directly', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/subscription`)
      .set(bearer(owner.accessToken))
      .send({ startDate: '2026-01-01', endDate: '2099-01-01' });
    expect(res.status).toBe(403);
  });
});

describe('farm subscription renewal requests', () => {
  it('the owner can only request renewal once the subscription has expired', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    // Built directly (not via `createFarm`, which sets an active subscription
    // by default) so the farm starts truly NOT_STARTED.
    const org = await createOrganization(app, owner.accessToken, { type: 'FARM' });
    await approveOrganization(app, admin.accessToken, org.id);
    const farm = { id: org.id };

    // NOT_STARTED — rejected
    const notStarted = await requestFarmRenewal(app, owner.accessToken, farm.id);
    expect(notStarted.status).toBe(409);
    expect(notStarted.body.error.code).toBe('SUBSCRIPTION_NOT_EXPIRED');

    // ACTIVE — rejected
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2026-01-01',
      endDate: '2099-01-01',
    });
    const active = await requestFarmRenewal(app, owner.accessToken, farm.id);
    expect(active.status).toBe(409);
    expect(active.body.error.code).toBe('SUBSCRIPTION_NOT_EXPIRED');

    // EXPIRED — accepted
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });
    const expired = await requestFarmRenewal(app, owner.accessToken, farm.id);
    expect(expired.status).toBe(201);
    expect(expired.body.data.status).toBe('PENDING');
  });

  it('only one open renewal request is allowed per farm at a time', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });

    const first = await requestFarmRenewal(app, owner.accessToken, farm.id);
    expect(first.status).toBe(201);

    const second = await requestFarmRenewal(app, owner.accessToken, farm.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('RENEWAL_REQUEST_ALREADY_PENDING');
  });

  it('a non-owner member of the farm cannot request a renewal', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: staff.id,
      role: 'STAFF',
    });
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });

    const res = await requestFarmRenewal(app, staff.accessToken, farm.id);
    expect(res.status).toBe(403);
  });

  it('admin approves a renewal — new dates are applied and the subscription is ACTIVE again', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });
    const created = await requestFarmRenewal(app, owner.accessToken, farm.id, { note: 'please renew' });

    const approve = await request(app)
      .post(
        `/api/v1/admin/organizations/${farm.id}/subscription-renewals/${created.body.data.id}/approve`,
      )
      .set(bearer(admin.accessToken))
      .send({ startDate: '2026-06-01', endDate: '2099-06-01' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');

    const org = await getOrg(owner.accessToken, farm.id);
    expect(org.details.subscriptionStatus).toBe('ACTIVE');
    expect(org.details.subscriptionEndDate).toBe('2099-06-01');
  });

  it('admin rejects a renewal with a reason — dates stay unchanged', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });
    const created = await requestFarmRenewal(app, owner.accessToken, farm.id);

    const reject = await request(app)
      .post(
        `/api/v1/admin/organizations/${farm.id}/subscription-renewals/${created.body.data.id}/reject`,
      )
      .set(bearer(admin.accessToken))
      .send({ reason: 'payment not received' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('REJECTED');
    expect(reject.body.data.decisionReason).toBe('payment not received');

    const org = await getOrg(owner.accessToken, farm.id);
    expect(org.details.subscriptionEndDate).toBe('2020-06-01');
    expect(org.details.subscriptionStatus).toBe('EXPIRED');
  });

  it('rejects an invalid transition — approving/rejecting an already-resolved request', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });
    const created = await requestFarmRenewal(app, owner.accessToken, farm.id);
    const reject = await request(app)
      .post(
        `/api/v1/admin/organizations/${farm.id}/subscription-renewals/${created.body.data.id}/reject`,
      )
      .set(bearer(admin.accessToken))
      .send({ reason: 'not approved' });
    expect(reject.status).toBe(200);

    const approveAfter = await request(app)
      .post(
        `/api/v1/admin/organizations/${farm.id}/subscription-renewals/${created.body.data.id}/approve`,
      )
      .set(bearer(admin.accessToken))
      .send({ startDate: '2026-01-01', endDate: '2099-01-01' });
    expect(approveAfter.status).toBe(409);
    expect(approveAfter.body.error.code).toBe('RENEWAL_REQUEST_NOT_PENDING');
  });

  it('unauthenticated requests are rejected', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/subscription-renewals`)
      .send({});
    expect(res.status).toBe(401);
  });
});
