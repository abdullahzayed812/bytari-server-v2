import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('admin management — clinics & veterinary offices (edit / delete)', () => {
  it('an admin edits a clinic’s profile (incl. license number) through the org API', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة قديمة',
    });
    const res = await request(app)
      .patch(`/api/v1/organizations/${clinic.id}`)
      .set(bearer(admin.accessToken))
      .send({ name: 'عيادة محدثة', phone: '0770111222', licenseNumber: 'ADM-9' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('عيادة محدثة');
    expect(res.body.data.details.licenseNumber).toBe('ADM-9');
  });

  it('DELETE soft-deletes from any status, closes pending renewals and hides it from discovery', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب للحذف',
    });
    await getTestDb()('farm_subscription_renewal_requests').insert({
      organization_id: office.id,
      requested_by_user_id: owner.id,
      status: 'PENDING',
    });
    const pendingClinic = await createOrganization(app, owner.accessToken, {
      type: 'CLINIC',
      name: 'عيادة معلقة',
    });

    for (const id of [office.id, pendingClinic.id]) {
      const del = await request(app)
        .delete(`/api/v1/admin/organizations/${id}`)
        .set(bearer(admin.accessToken));
      expect(del.status).toBe(200);
      expect(del.body.data.status).toBe('DEACTIVATED');
    }
    const renewals = await getTestDb()('farm_subscription_renewal_requests')
      .where({ organization_id: office.id })
      .select('status');
    expect(renewals.map((r: { status: string }) => r.status)).toEqual(['REJECTED']);

    const viewer = await registerUser(app);
    const discover = await request(app)
      .get(`/api/v1/organizations/discover/${office.id}`)
      .set(bearer(viewer.accessToken));
    expect(discover.status).toBe(404);

    // The owner can no longer operate it.
    const ownerPatch = await request(app)
      .patch(`/api/v1/organizations/${office.id}`)
      .set(bearer(owner.accessToken))
      .send({ name: 'x y' });
    expect(ownerPatch.status).toBe(403);

    const audit = await getTestDb()('audit_logs')
      .where({ action: 'ORGANIZATION_DELETED', entity_id: office.id })
      .first();
    expect(audit).toBeTruthy();
  });

  it('a non-admin (even the owner) cannot use the admin delete', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة',
    });
    const res = await request(app)
      .delete(`/api/v1/admin/organizations/${clinic.id}`)
      .set(bearer(owner.accessToken));
    expect(res.status).toBe(403);
  });
});
