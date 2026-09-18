import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
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

  it('filters to a single organization type — VETERINARY_OFFICE requests only, no FARM/CLINIC mixed in', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);

    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });
    const farmRenewal = await requestFarmRenewal(app, owner.accessToken, farm.id);
    expect(farmRenewal.status).toBe(201);

    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, office.id, {
      startDate: '2020-01-01',
      endDate: '2020-06-01',
    });
    const officeRenewal = await request(app)
      .post(`/api/v1/organizations/${office.id}/subscription-renewals`)
      .set(bearer(owner.accessToken))
      .send({});
    expect(officeRenewal.status).toBe(201);

    const res = await request(app)
      .get('/api/v1/admin/organizations/subscription-renewals/pending')
      .query({ type: 'VETERINARY_OFFICE' })
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    const organizationIds = res.body.data.map((r: { organizationId: string }) => r.organizationId);
    expect(organizationIds).toContain(office.id);
    expect(organizationIds).not.toContain(farm.id);
  });

  it('rejects a caller without organization.admin.read', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/admin/organizations/subscription-renewals/pending')
      .set(bearer(user.accessToken));
    expect(res.status).toBe(403);
  });
});
