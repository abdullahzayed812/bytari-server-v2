import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  assignOrganizationSupervisor,
  bearer,
  createFarm,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  setFarmSubscriptionAsAdmin,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

function setSubscription(actorToken: string, organizationId: string) {
  return request(app)
    .post(`/api/v1/organizations/${organizationId}/farm/subscription`)
    .set(bearer(actorToken))
    .send({ startDate: '2026-01-01', endDate: '2099-01-01' });
}

describe('farm subscription — the Responsible Supervisor manages only their scoped farms', () => {
  it('a supervisor explicitly granted farm.subscription.manage on Farm A can manage Farm A but not Farm B', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const supervisor = await registerApprovedVet(app);
    const farmA = await createFarm(app, ownerA.accessToken, admin.accessToken, { name: 'Farm A' });
    const farmB = await createFarm(app, ownerB.accessToken, admin.accessToken, { name: 'Farm B' });

    await assignOrganizationSupervisor(app, ownerA.accessToken, farmA.id, {
      userId: supervisor.id,
      permissions: ['farm.subscription.manage'],
    });

    const onFarmA = await setSubscription(supervisor.accessToken, farmA.id);
    expect(onFarmA.status).toBe(200);

    const onFarmB = await setSubscription(supervisor.accessToken, farmB.id);
    expect(onFarmB.status).toBe(403);
  });

  it('a SUPERVISOR membership without the farm.subscription.manage grant cannot manage the subscription', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const supervisor = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    // Granted a DIFFERENT permission only — SUPERVISOR carries no permission by role alone.
    await assignOrganizationSupervisor(app, owner.accessToken, farm.id, {
      userId: supervisor.id,
      permissions: ['member.read'],
    });

    const res = await setSubscription(supervisor.accessToken, farm.id);
    expect(res.status).toBe(403);
  });

  it('the farm owner cannot set their own subscription — that stays Admin/Supervisor territory', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await setSubscription(owner.accessToken, farm.id);
    expect(res.status).toBe(403);
  });

  it('an unrelated authenticated user cannot manage a farm’s subscription', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const stranger = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await setSubscription(stranger.accessToken, farm.id);
    expect(res.status).toBe(403);
  });

  it('the global admin can manage any farm’s subscription regardless of membership', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2026-01-01',
      endDate: '2099-01-01',
    });
    expect(res.status).toBe(200);
  });
});
