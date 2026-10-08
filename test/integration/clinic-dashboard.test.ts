import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { businessToday } from '../../src/shared/time/business-date.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createAnimal,
  createMedicalRecord,
  createVaccination,
  openClinicPet,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const clinicOwner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const staff = await registerUser(app);
  const petOwner = await registerUser(app);
  const outsider = await registerApprovedVet(app);
  const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Dashboard Clinic',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: staff.id,
    role: 'STAFF',
  });
  const animal = await createAnimal(app, petOwner.accessToken, {
    name: 'Milo',
    breed: 'Husky',
    notes: 'owner-private note',
  });
  await openClinicPet(app, clinicOwner.accessToken, clinic.id, animal.publicCode);
  return { admin, clinicOwner, vet, staff, petOwner, outsider, clinic, animal };
}

const summaryUrl = (orgId: string) => `${API}/organizations/${orgId}/clinic-dashboard/summary`;
const animalUrl = (orgId: string, animalId: string) =>
  `${API}/organizations/${orgId}/animals/${animalId}`;

describe('clinic dashboard summary', () => {
  it('gives the owner full permissions and clinic-scoped stats', async () => {
    const { clinicOwner, vet, petOwner, clinic, animal } = await setup();
    const today = businessToday();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, { visitDate: today });
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      visitDate: '2026-01-01',
    });
    await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      administeredOn: '2026-01-01',
      nextDueOn: today,
    });

    const booked = await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-appointments`)
      .set(bearer(petOwner.accessToken))
      .send({
        animalId: animal.id,
        visitType: 'CHECKUP',
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(booked.status).toBe(201);
    await getTestDb()('clinic_appointments')
      .where({ id: booked.body.data.id })
      .update({ scheduled_for: new Date(`${today}T12:00:00+03:00`) });

    const res = await request(app).get(summaryUrl(clinic.id)).set(bearer(clinicOwner.accessToken));
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(Object.values(data.permissions).every((v) => v === true)).toBe(true);
    expect(data.animals).toEqual({ activeCount: 1 });
    expect(data.medical).toMatchObject({
      medicalRecordsCount: 2,
      medicalRecordsToday: 1,
      vaccinationsCount: 1,
      vaccinationsDueToday: 1,
      visitorsToday: 1,
      medicalAnimals: 1,
      vaccinationAnimals: 1,
      totalDistinctAnimals: 1,
    });
    expect(data.appointments).toMatchObject({
      todayCount: 1,
      pendingCount: 1,
      appointmentAnimals: 1,
    });
    expect(data.followersCount).toBe(0);
  });

  it('derives a VETERINARIAN’s permissions from org RBAC (no access.manage, no broadcast)', async () => {
    const { vet, clinic } = await setup();
    const res = await request(app).get(summaryUrl(clinic.id)).set(bearer(vet.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toMatchObject({
      canViewAnimals: true,
      canManageAnimalAccess: false,
      canViewMedicalRecords: true,
      canCreateMedicalRecords: true,
      canViewAppointments: true,
      canManageAppointments: true,
      canSendBroadcast: false,
      canEditOrganization: false,
    });
    // Opening a pet links nothing: the clinic "has" no pet until it records one.
    expect(res.body.data.animals).toEqual({ activeCount: 0 });
  });

  it('withholds animal + medical counts from STAFF (no animal / medical read permission)', async () => {
    const { staff, clinic } = await setup();
    const res = await request(app).get(summaryUrl(clinic.id)).set(bearer(staff.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.permissions.canViewAnimals).toBe(false);
    expect(res.body.data.animals).toBeNull();
    expect(res.body.data.medical).toBeNull();
    expect(res.body.data.appointments).not.toBeNull();
  });

  it('403s a non-member and 400s a non-clinic organization', async () => {
    const { admin, outsider, clinic, petOwner } = await setup();
    const asOutsider = await request(app)
      .get(summaryUrl(clinic.id))
      .set(bearer(outsider.accessToken));
    expect(asOutsider.status).toBe(403);
    const asPetOwner = await request(app)
      .get(summaryUrl(clinic.id))
      .set(bearer(petOwner.accessToken));
    expect(asPetOwner.status).toBe(403);

    const office = await createActiveOrganization(app, outsider.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Office',
    });
    const asOffice = await request(app)
      .get(summaryUrl(office.id))
      .set(bearer(outsider.accessToken));
    expect(asOffice.status).toBe(400);
    expect(asOffice.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });

  it('requires authentication', async () => {
    const { clinic } = await setup();
    const res = await request(app).get(summaryUrl(clinic.id));
    expect(res.status).toBe(401);
  });
});

describe('clinic-visible animal profile', () => {
  it('returns the animal profile + stats without internal owner ids or the owner’s private notes', async () => {
    const { vet, clinic, animal } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      visitDate: '2026-02-01',
    });
    await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      administeredOn: '2026-01-01',
      nextDueOn: '2099-01-01',
    });

    const res = await request(app)
      .get(animalUrl(clinic.id, animal.id))
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: animal.id,
      name: 'Milo',
      breed: 'Husky',
      stats: {
        medicalRecordsCount: 1,
        vaccinationsCount: 1,
        lastVisitDate: '2026-02-01',
        nextVaccinationDue: '2099-01-01',
      },
    });
    expect(res.body.data.publicCode).toBe(animal.publicCode);
    expect(res.body.data.relationship).toMatchObject({
      firstActivityAt: expect.any(String),
      lastActivityAt: expect.any(String),
    });
    expect(res.body.data).not.toHaveProperty('access');
    expect(res.body.data).not.toHaveProperty('currentOwnerUserId');
    expect(res.body.data).not.toHaveProperty('createdBy');
    expect(res.body.data).not.toHaveProperty('notes');
    expect(res.body.data).not.toHaveProperty('galleryKeys');
  });

  it('stats are THIS clinic’s only — another clinic opening the same pet sees none of them', async () => {
    const { admin, vet, outsider, clinic, animal } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      visitDate: '2026-02-01',
      diagnosis: 'Clinic A private diagnosis',
    });
    await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      administeredOn: '2026-01-01',
      nextDueOn: '2099-01-01',
    });
    const otherClinic = await createActiveOrganization(
      app,
      outsider.accessToken,
      admin.accessToken,
      { type: 'CLINIC', name: 'Other Clinic' },
    );
    const opened = await openClinicPet(
      app,
      outsider.accessToken,
      otherClinic.id,
      animal.publicCode,
    );
    expect(opened).toMatchObject({ animalId: animal.id, workedWith: false });

    const crossClinic = await request(app)
      .get(animalUrl(otherClinic.id, animal.id))
      .set(bearer(outsider.accessToken));
    expect(crossClinic.status).toBe(200);
    expect(crossClinic.body.data.relationship).toBeNull();
    expect(crossClinic.body.data.stats).toEqual({
      medicalRecordsCount: 0,
      vaccinationsCount: 0,
      lastVisitDate: null,
      nextVaccinationDue: null,
    });
    expect(JSON.stringify(crossClinic.body)).not.toContain('Clinic A private diagnosis');

    // Outsider is not a member of the first clinic at all.
    const nonMember = await request(app)
      .get(animalUrl(clinic.id, animal.id))
      .set(bearer(outsider.accessToken));
    expect(nonMember.status).toBe(403);
  });

  it('404s an unknown animal id (no existence leak)', async () => {
    const { vet, clinic } = await setup();
    const res = await request(app)
      .get(animalUrl(clinic.id, '00000000-0000-4000-8000-000000000000'))
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(404);
  });

  it('403s clinic STAFF (no animal.veterinary.access.read)', async () => {
    const { staff, clinic, animal } = await setup();
    const res = await request(app)
      .get(animalUrl(clinic.id, animal.id))
      .set(bearer(staff.accessToken));
    expect(res.status).toBe(403);
  });
});
