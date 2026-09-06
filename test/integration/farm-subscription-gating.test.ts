import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  approveOrganization,
  bearer,
  createFarm,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  setFarmSubscriptionAsAdmin,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const flockBody = {
  name: 'Batch 1',
  birdType: 'CHICKEN',
  birdCount: 1000,
  arrivalDate: '2026-01-01',
};

describe('farm operations require an ACTIVE subscription', () => {
  it('blocks poultry-flock creation while the subscription is NOT_STARTED', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    // Approved but with no subscription set yet — `createFarm` sets one by
    // default (most tests need a fully operational farm), so this one test
    // builds the farm directly to get the true NOT_STARTED state.
    const org = await createOrganization(app, owner.accessToken, { type: 'FARM' });
    await approveOrganization(app, admin.accessToken, org.id);

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/poultry/flocks`)
      .set(bearer(owner.accessToken))
      .send(flockBody);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FARM_SUBSCRIPTION_NOT_ACTIVE');
  });

  it('blocks poultry-flock creation once the subscription has EXPIRED', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });

    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/poultry/flocks`)
      .set(bearer(owner.accessToken))
      .send(flockBody);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FARM_SUBSCRIPTION_NOT_ACTIVE');
  });

  it('allows poultry-flock creation once the subscription is ACTIVE', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2026-01-01',
      endDate: '2099-01-01',
    });

    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/poultry/flocks`)
      .set(bearer(owner.accessToken))
      .send(flockBody);
    expect(res.status).toBe(201);
  });

  it('blocks farm expenses, appointments and the flock list while not active', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'FARM' });
    await approveOrganization(app, admin.accessToken, org.id);

    const list = await request(app)
      .get(`/api/v1/organizations/${org.id}/poultry/flocks`)
      .set(bearer(owner.accessToken));
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('FARM_SUBSCRIPTION_NOT_ACTIVE');

    const expense = await request(app)
      .post(`/api/v1/organizations/${org.id}/farm/expenses`)
      .set(bearer(owner.accessToken))
      .send({ category: 'FEED', amount: 100, spentOn: '2026-01-01' });
    expect(expense.status).toBe(403);
    expect(expense.body.error.code).toBe('FARM_SUBSCRIPTION_NOT_ACTIVE');

    const appt = await request(app)
      .post(`/api/v1/organizations/${org.id}/farm/appointments`)
      .set(bearer(owner.accessToken))
      .send({ title: 'Vet visit', scheduledFor: '2026-02-01' });
    expect(appt.status).toBe(403);
    expect(appt.body.error.code).toBe('FARM_SUBSCRIPTION_NOT_ACTIVE');
  });

  it('the farm profile stays readable and the renewal workflow stays usable regardless of subscription state', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'FARM' });
    await approveOrganization(app, admin.accessToken, org.id);

    const profile = await request(app)
      .get(`/api/v1/organizations/${org.id}/farm/profile`)
      .set(bearer(owner.accessToken));
    expect(profile.status).toBe(200);

    const renewals = await request(app)
      .get(`/api/v1/organizations/${org.id}/farm/subscription-renewals`)
      .set(bearer(owner.accessToken));
    expect(renewals.status).toBe(200);
  });

  it('a global admin bypasses the subscription gate', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/poultry/flocks`)
      .set(bearer(admin.accessToken))
      .send(flockBody);
    expect(res.status).toBe(201);
  });
});
