import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
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

async function setPeriod(table: string, organizationId: string, start: string, end: string) {
  await getTestDb()(table)
    .where({ organization_id: organizationId })
    .update({ subscription_start_date: start, subscription_end_date: end });
}

const productBody = {
  name: 'لقاح نيوكاسل',
  productType: 'MEDICINE',
  price: '15000',
  stockQuantity: 10,
};

/** Final corrections §10 — expired clinics / offices. */
describe('expired clinics and veterinary offices', () => {
  it('an EXPIRED clinic / office disappears from the pet-owner directory and its search; renewal brings it back', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة الشفاء',
    });
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب الشفاء',
    });
    const ids = async (type: string, search?: string) => {
      const res = await request(app)
        .get('/api/v1/organizations/discover')
        .query({ type, ...(search ? { search } : {}) })
        .set(bearer(petOwner.accessToken));
      expect(res.status).toBe(200);
      return (res.body.data as Array<{ id: string }>).map((o) => o.id);
    };
    expect(await ids('CLINIC')).toContain(clinic.id);
    expect(await ids('VETERINARY_OFFICE', 'الشفاء')).toContain(office.id);

    await setPeriod('clinic_details', clinic.id, '2025-01-01', '2025-06-30');
    await setPeriod('veterinary_office_details', office.id, '2025-01-01', '2025-06-30');
    expect(await ids('CLINIC')).not.toContain(clinic.id);
    expect(await ids('CLINIC', 'الشفاء')).not.toContain(clinic.id);
    expect(await ids('VETERINARY_OFFICE', 'الشفاء')).not.toContain(office.id);
    const catalog = await request(app)
      .get(`/api/v1/organizations/discover/${office.id}/office-products`)
      .set(bearer(petOwner.accessToken));
    expect(catalog.status).toBe(404);

    await setPeriod('clinic_details', clinic.id, '2026-01-01', '2999-12-31');
    expect(await ids('CLINIC')).toContain(clinic.id);
  });

  it('an EXPIRED office is fully locked (no product reads/writes, no dashboard, no broadcast); renewal stays open; admin bypasses', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const base = `/api/v1/organizations/${office.id}/office-products`;
    const created = await request(app).post(base).set(bearer(owner.accessToken)).send(productBody);
    expect(created.status).toBe(201);

    await setPeriod('veterinary_office_details', office.id, '2025-01-01', '2025-06-30');

    const blocked = await request(app).post(base).set(bearer(owner.accessToken)).send(productBody);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_SUBSCRIPTION_EXPIRED');
    const patch = await request(app)
      .patch(`${base}/${created.body.data.id}`)
      .set(bearer(owner.accessToken))
      .send({ isHidden: true });
    expect(patch.status).toBe(403);
    const del = await request(app)
      .delete(`${base}/${created.body.data.id}`)
      .set(bearer(owner.accessToken));
    expect(del.status).toBe(403);
    const broadcast = await request(app)
      .post(`/api/v1/organizations/${office.id}/broadcast`)
      .set(bearer(owner.accessToken))
      .send({ title: 'عرض', body: 'خصم' });
    expect(broadcast.status).toBe(403);

    // Additional corrections §4: management is COMPLETELY blocked — the owner can
    // no longer even list / view its products or open the dashboard summary.
    for (const path of [base, `${base}/${created.body.data.id}`]) {
      const read = await request(app).get(path).set(bearer(owner.accessToken));
      expect(read.status).toBe(403);
      expect(read.body.error.code).toBe('ORGANIZATION_SUBSCRIPTION_EXPIRED');
    }
    const summary = await request(app)
      .get(`/api/v1/organizations/${office.id}/office-dashboard/summary`)
      .set(bearer(owner.accessToken));
    expect(summary.status).toBe(403);
    // …but the renewal flow stays reachable
    const renewals = await request(app)
      .get(`/api/v1/organizations/${office.id}/subscription-renewals`)
      .set(bearer(owner.accessToken));
    expect(renewals.status).not.toBe(403);

    const adminList = await request(app).get(base).set(bearer(admin.accessToken));
    expect(adminList.status).toBe(200);

    const byAdmin = await request(app).post(base).set(bearer(admin.accessToken)).send(productBody);
    expect(byAdmin.status).toBe(201);
  });
});
