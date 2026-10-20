import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { businessToday } from '../../src/shared/time/business-date.js';
import {
  bearer,
  createActiveOrganization,
  createFarm,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';
const ADMIN = `${API}/admin/home-sections/featured-organizations`;
const PUBLIC = `${API}/home-sections/featured-organizations`;

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seed() {
  const admin = await registerAdmin(app);
  const vet = await registerApprovedVet(app);
  const viewer = await registerUser(app);
  const clinic = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'عيادة مميزة',
  });
  const office = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
    type: 'VETERINARY_OFFICE',
    name: 'مكتب مميز',
  });
  return { admin, vet, viewer, clinic, office, today: businessToday() };
}

async function seedOffice(vetToken: string, adminToken: string) {
  const office = await createActiveOrganization(app, vetToken, adminToken, {
    type: 'VETERINARY_OFFICE',
    name: 'مكتب إضافي',
  });
  return { office };
}

const visibleIds = async (token: string, placement: string) => {
  const res = await request(app).get(PUBLIC).query({ placement }).set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data.map((o: { id: string }) => o.id) as string[];
};

describe('featured home organizations — admin management', () => {
  it('ADMIN adds, lists (with state), updates and removes entries; every write is audited', async () => {
    const { admin, clinic, office, today } = await seed();
    const t = bearer(admin.accessToken);

    const active = await request(app)
      .post(ADMIN)
      .set(t)
      .send({
        organizationId: clinic.id,
        placement: 'PET_OWNER_HOME',
        startsOn: addDays(today, -1),
        endsOn: addDays(today, 10),
      });
    expect(active.status).toBe(201);
    expect(active.body.data.state).toBe('ACTIVE');
    expect(active.body.data.organization).toMatchObject({ name: 'عيادة مميزة', type: 'CLINIC' });

    const scheduled = await request(app)
      .post(ADMIN)
      .set(t)
      .send({
        organizationId: office.id,
        placement: 'VETERINARIAN_HOME',
        // unpadded dates are accepted and normalized
        startsOn: addDays(today, 3).replace(/-0/g, '-'),
        endsOn: addDays(today, 30),
      });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.data.state).toBe('SCHEDULED');
    expect(scheduled.body.data.startsOn).toBe(addDays(today, 3));

    const list = await request(app).get(ADMIN).set(t);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    const onlyVet = await request(app).get(ADMIN).query({ placement: 'VETERINARIAN_HOME' }).set(t);
    expect(onlyVet.body.data.map((e: { id: string }) => e.id)).toEqual([scheduled.body.data.id]);

    const disabled = await request(app)
      .patch(`${ADMIN}/${active.body.data.id}`)
      .set(t)
      .send({ isEnabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.state).toBe('DISABLED');

    const expired = await request(app)
      .patch(`${ADMIN}/${active.body.data.id}`)
      .set(t)
      .send({ isEnabled: true, startsOn: addDays(today, -20), endsOn: addDays(today, -1) });
    expect(expired.body.data.state).toBe('EXPIRED');

    const removed = await request(app).delete(`${ADMIN}/${scheduled.body.data.id}`).set(t);
    expect(removed.status).toBe(200);
    expect((await request(app).get(ADMIN).set(t)).body.data).toHaveLength(1);

    const audits = await getTestDb()('audit_logs')
      .where('entity_type', 'HOME_FEATURED_ORGANIZATION')
      .pluck('action');
    expect(audits.sort()).toEqual(
      [
        'HOME_FEATURED_ORGANIZATION_ADDED',
        'HOME_FEATURED_ORGANIZATION_ADDED',
        'HOME_FEATURED_ORGANIZATION_UPDATED',
        'HOME_FEATURED_ORGANIZATION_UPDATED',
        'HOME_FEATURED_ORGANIZATION_REMOVED',
      ].sort(),
    );
  });

  it('validates: existing clinic / office only, active only, window order, no duplicates', async () => {
    const { admin, vet, clinic, today } = await seed();
    const t = bearer(admin.accessToken);
    const base = { placement: 'PET_OWNER_HOME', startsOn: today, endsOn: addDays(today, 5) };

    const farmOwner = await registerUser(app);
    const farm = await createFarm(app, farmOwner.accessToken, admin.accessToken);
    const notFeaturable = await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...base, organizationId: farm.id });
    expect(notFeaturable.status).toBe(400);

    const missing = await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...base, organizationId: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(404);

    const backwards = await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...base, organizationId: clinic.id, startsOn: today, endsOn: addDays(today, -1) });
    expect(backwards.status).toBe(422);

    const badDate = await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...base, organizationId: clinic.id, startsOn: '2026-02-30' });
    expect(badDate.status).toBe(422);

    expect(
      (
        await request(app)
          .post(ADMIN)
          .set(t)
          .send({ ...base, organizationId: clinic.id })
      ).status,
    ).toBe(201);
    const dup = await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...base, organizationId: clinic.id });
    expect(dup.status).toBe(409);

    // Each home page features its own audience's type: clinics on the Pet
    // Owner home, veterinary offices / companies on the Veterinarian home.
    const clinicOnVetHome = await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...base, placement: 'VETERINARIAN_HOME', organizationId: clinic.id });
    expect(clinicOnVetHome.status).toBe(400);
    expect(clinicOnVetHome.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
    const { office } = await seedOffice(vet.accessToken, admin.accessToken);
    const officeOnOwnerHome = await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...base, organizationId: office.id });
    expect(officeOnOwnerHome.status).toBe(400);
    expect(
      (
        await request(app)
          .post(ADMIN)
          .set(t)
          .send({ ...base, placement: 'VETERINARIAN_HOME', organizationId: office.id })
      ).status,
    ).toBe(201);

    // A pending clinic cannot be featured.
    const pending = await request(app)
      .post(`${API}/organizations`)
      .set(bearer(vet.accessToken))
      .send({ type: 'CLINIC', name: 'Pending', termsAccepted: true });
    const pendingRes = await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...base, organizationId: pending.body.data.id });
    expect(pendingRes.status).toBe(400);
  });

  it('is ADMIN-only (home_section.manage): users get 403 on every admin route', async () => {
    const { viewer, clinic, today } = await seed();
    const t = bearer(viewer.accessToken);
    expect((await request(app).get(ADMIN).set(t)).status).toBe(403);
    expect(
      (
        await request(app).post(ADMIN).set(t).send({
          organizationId: clinic.id,
          placement: 'PET_OWNER_HOME',
          startsOn: today,
          endsOn: today,
        })
      ).status,
    ).toBe(403);
    const id = '00000000-0000-4000-8000-000000000000';
    expect(
      (await request(app).patch(`${ADMIN}/${id}`).set(t).send({ isEnabled: false })).status,
    ).toBe(403);
    expect((await request(app).delete(`${ADMIN}/${id}`).set(t)).status).toBe(403);
  });
});

describe('featured home organizations — public carousel', () => {
  it('shows only enabled entries inside their window whose organization is publicly visible', async () => {
    const { admin, vet, viewer, clinic, today } = await seed();
    const t = bearer(admin.accessToken);
    const clinic2 = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة ثانية',
    });
    const add = (organizationId: string, extra: Record<string, unknown> = {}) =>
      request(app)
        .post(ADMIN)
        .set(t)
        .send({
          organizationId,
          placement: 'PET_OWNER_HOME',
          startsOn: today,
          endsOn: today, // the last day still counts
          ...extra,
        });

    const c = await add(clinic.id, { sortOrder: 2 });
    await add(clinic2.id, { sortOrder: 1 });
    expect(await visibleIds(viewer.accessToken, 'PET_OWNER_HOME')).toEqual([clinic2.id, clinic.id]);
    expect(await visibleIds(viewer.accessToken, 'VETERINARIAN_HOME')).toEqual([]);

    // Public card carries the directory profile fields.
    const cards = await request(app)
      .get(PUBLIC)
      .query({ placement: 'PET_OWNER_HOME' })
      .set(bearer(viewer.accessToken));
    expect(cards.body.data[1]).toMatchObject({
      id: clinic.id,
      name: 'عيادة مميزة',
      type: 'CLINIC',
    });

    // Disabled → hidden; re-enabled → back.
    await request(app).patch(`${ADMIN}/${c.body.data.id}`).set(t).send({ isEnabled: false });
    expect(await visibleIds(viewer.accessToken, 'PET_OWNER_HOME')).toEqual([clinic2.id]);
    await request(app).patch(`${ADMIN}/${c.body.data.id}`).set(t).send({ isEnabled: true });

    // Scheduled for later → hidden.
    await request(app)
      .patch(`${ADMIN}/${c.body.data.id}`)
      .set(t)
      .send({ startsOn: addDays(today, 1), endsOn: addDays(today, 3) });
    expect(await visibleIds(viewer.accessToken, 'PET_OWNER_HOME')).toEqual([clinic2.id]);
    await request(app).patch(`${ADMIN}/${c.body.data.id}`).set(t).send({ startsOn: today });

    // Organization visibility rules still apply: expired subscription / suspended.
    await getTestDb()('clinic_details')
      .where({ organization_id: clinic.id })
      .update({
        subscription_start_date: addDays(today, -40),
        subscription_end_date: addDays(today, -1),
      });
    expect(await visibleIds(viewer.accessToken, 'PET_OWNER_HOME')).toEqual([clinic2.id]);
    const adminRow = (await request(app).get(ADMIN).set(t)).body.data.find(
      (e: { id: string }) => e.id === c.body.data.id,
    );
    expect(adminRow.state).toBe('ACTIVE');
    expect(adminRow.organization.publiclyVisible).toBe(false);

    await getTestDb()('clinic_details')
      .where({ organization_id: clinic.id })
      .update({ subscription_end_date: addDays(today, 30) });
    await getTestDb()('organizations').where({ id: clinic2.id }).update({ status: 'SUSPENDED' });
    expect(await visibleIds(viewer.accessToken, 'PET_OWNER_HOME')).toEqual([clinic.id]);
  });

  it('each home page only ever shows its own audience’s organization type', async () => {
    const { admin, viewer, clinic, office, today } = await seed();
    const t = bearer(admin.accessToken);
    const window = { startsOn: today, endsOn: addDays(today, 5) };
    await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...window, placement: 'PET_OWNER_HOME', organizationId: clinic.id })
      .expect(201);
    await request(app)
      .post(ADMIN)
      .set(t)
      .send({ ...window, placement: 'VETERINARIAN_HOME', organizationId: office.id })
      .expect(201);
    // A legacy cross-audience entry (created before the per-page rule) stays
    // in the admin list, flagged hidden, and never reaches the public read.
    const [legacy] = await getTestDb()('featured_home_organizations')
      .insert({
        organization_id: clinic.id,
        placement: 'VETERINARIAN_HOME',
        starts_on: today,
        ends_on: addDays(today, 5),
        is_enabled: true,
        sort_order: 0,
      })
      .returning('id');

    expect(await visibleIds(viewer.accessToken, 'PET_OWNER_HOME')).toEqual([clinic.id]);
    expect(await visibleIds(viewer.accessToken, 'VETERINARIAN_HOME')).toEqual([office.id]);
    const legacyRow = (await request(app).get(ADMIN).set(t)).body.data.find(
      (e: { id: string }) => e.id === (legacy as { id: string }).id,
    );
    expect(legacyRow.state).toBe('ACTIVE');
    expect(legacyRow.organization.publiclyVisible).toBe(false);
  });

  it('requires a valid placement and authentication', async () => {
    const { viewer } = await seed();
    expect(
      (await request(app).get(PUBLIC).query({ placement: 'NOPE' }).set(bearer(viewer.accessToken)))
        .status,
    ).toBe(422);
    expect((await request(app).get(PUBLIC).query({ placement: 'PET_OWNER_HOME' })).status).toBe(
      401,
    );
  });
});
