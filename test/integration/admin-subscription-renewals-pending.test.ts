import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
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

describe('admin-wide pending renewals — GET /admin/organizations/subscription-renewals/pending', () => {
  it('lists PENDING renewal requests across every organization, with the organization name', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });
    const created = await requestFarmRenewal(app, owner.accessToken, farm.id);
    expect(created.status).toBe(201);

    const res = await request(app)
      .get('/api/v1/admin/organizations/subscription-renewals/pending')
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    const item = res.body.data.find(
      (r: { organizationId: string }) => r.organizationId === farm.id,
    );
    expect(item).toBeDefined();
    expect(item.status).toBe('PENDING');
    expect(typeof item.organizationName).toBe('string');
    expect(item.organizationName.length).toBeGreaterThan(0);
  });

  it('rejects a caller without organization.admin.read', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/admin/organizations/subscription-renewals/pending')
      .set(bearer(user.accessToken));
    expect(res.status).toBe(403);
  });
});
