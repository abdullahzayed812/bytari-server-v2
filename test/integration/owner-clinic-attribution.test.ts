import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createAnimal,
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
  const staff = await registerApprovedVet(app);
  const petOwner = await registerUser(app);
  const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Nile Pet Clinic',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: staff.id,
    role: 'STAFF',
  });
  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Milo' });
  await openClinicPet(app, clinicOwner.accessToken, clinic.id, animal.publicCode);
  return { clinicOwner, vet, staff, petOwner, clinic, animal };
}

describe('pet owner sees the clinic name, never the veterinarian', () => {
  it('owner vaccination list / detail / timeline carry clinicName and no recordedByUserId', async () => {
    const { vet, petOwner, clinic, animal } = await setup();
    const v = await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      vaccineName: 'Rabies',
    });

    const list = await request(app)
      .get(`${API}/animals/${animal.id}/vaccinations`)
      .set(bearer(petOwner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({
      id: v.id,
      clinicName: 'Nile Pet Clinic',
      recordedByUserId: null,
    });
    expect(JSON.stringify(list.body)).not.toContain(vet.id);

    const one = await request(app)
      .get(`${API}/animals/${animal.id}/vaccinations/${v.id}`)
      .set(bearer(petOwner.accessToken));
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ clinicName: 'Nile Pet Clinic', recordedByUserId: null });

    const timeline = await request(app)
      .get(`${API}/animals/${animal.id}/medical-history`)
      .set(bearer(petOwner.accessToken));
    expect(timeline.status).toBe(200);
    expect(timeline.body.data[0]).toMatchObject({
      type: 'VACCINATION',
      clinicName: 'Nile Pet Clinic',
      recordedByUserId: null,
    });
    expect(JSON.stringify(timeline.body)).not.toContain(vet.id);
  });

  it('owner reminders carry clinicName and no recordedByUserId', async () => {
    const { vet, petOwner, clinic, animal } = await setup();
    const created = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${animal.id}/reminders`)
      .set(bearer(vet.accessToken))
      .send({ title: 'Deworming', reminderDate: '2027-01-10', reminderType: 'OTHER' });
    expect(created.status).toBe(201);

    const res = await request(app)
      .get(`${API}/animals/${animal.id}/reminders`)
      .set(bearer(petOwner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      clinicName: 'Nile Pet Clinic',
      recordedByUserId: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(vet.id);
  });

  it('the clinic owner and clinic staff still see the veterinarian', async () => {
    const { clinicOwner, vet, staff, clinic, animal } = await setup();
    const v = await createVaccination(app, vet.accessToken, clinic.id, animal.id);
    for (const token of [clinicOwner.accessToken, staff.accessToken]) {
      const res = await request(app)
        .get(`${API}/organizations/${clinic.id}/animals/${animal.id}/vaccinations/${v.id}`)
        .set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.data.recordedByUserId).toBe(vet.id);
    }
  });
});
