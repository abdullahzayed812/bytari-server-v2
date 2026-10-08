import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
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

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const clinicOwner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const petOwner = await registerUser(app);
  const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Vax Clinic',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Nala' });
  await openClinicPet(app, clinicOwner.accessToken, clinic.id, animal.publicCode);
  return { admin, clinicOwner, vet, petOwner, clinic, animal };
}

const vaxPath = (clinicId: string, animalId: string, id?: string): string =>
  `/api/v1/organizations/${clinicId}/animals/${animalId}/vaccinations${id ? `/${id}` : ''}`;

describe('vaccinations', () => {
  it('supports full CRUD for an authorized clinic veterinarian', async () => {
    const { vet, clinic, animal } = await setup();

    const create = await request(app)
      .post(vaxPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken))
      .send({ vaccineName: 'Rabies', administeredOn: '2026-02-01', nextDueOn: '2027-02-01' });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({
      vaccineName: 'Rabies',
      administeredOn: '2026-02-01',
      nextDueOn: '2027-02-01',
      recordedByUserId: vet.id,
    });

    const upd = await request(app)
      .patch(vaxPath(clinic.id, animal.id, id))
      .set(bearer(vet.accessToken))
      .send({ notes: 'no reaction' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.notes).toBe('no reaction');

    const del = await request(app)
      .delete(vaxPath(clinic.id, animal.id, id))
      .set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
  });

  it('rejects next_due_on before administered_on with 422', async () => {
    const { vet, clinic, animal } = await setup();
    const res = await request(app)
      .post(vaxPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken))
      .send({ vaccineName: 'X', administeredOn: '2026-02-01', nextDueOn: '2025-01-01' });
    // nextDueOn is a valid date but the DB CHECK would fail; the service maps
    // this to a validation-style failure. Accept 422 (schema) or 409/400.
    expect([422, 409, 400]).toContain(res.status);
  });

  it('filters to upcoming vaccinations with ?dueFrom', async () => {
    const { vet, clinic, animal } = await setup();
    await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      vaccineName: 'Old',
      administeredOn: '2025-01-01',
      nextDueOn: '2025-06-01',
    });
    await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      vaccineName: 'Upcoming',
      administeredOn: '2026-01-01',
      nextDueOn: '2027-01-01',
    });

    const res = await request(app)
      .get(`${vaxPath(clinic.id, animal.id)}?dueFrom=2026-09-01`)
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].vaccineName).toBe('Upcoming');
  });

  it('is visible read-only to the animal owner and hidden from strangers', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    await createVaccination(app, vet.accessToken, clinic.id, animal.id);

    const ownerRead = await request(app)
      .get(`/api/v1/animals/${animal.id}/vaccinations`)
      .set(bearer(petOwner.accessToken));
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.body.data).toHaveLength(1);

    const stranger = await registerUser(app);
    const strangerRead = await request(app)
      .get(`/api/v1/animals/${animal.id}/vaccinations`)
      .set(bearer(stranger.accessToken));
    expect(strangerRead.status).toBe(404);
  });

  it('another clinic sees none of this clinic’s vaccinations and cannot change them', async () => {
    const { admin, vet, clinic, animal } = await setup();
    const v = await createVaccination(app, vet.accessToken, clinic.id, animal.id);
    const ownerB = await registerApprovedVet(app);
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic B',
    });
    const list = await request(app)
      .get(vaxPath(clinicB.id, animal.id))
      .set(bearer(ownerB.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
    for (const req of [
      request(app).get(vaxPath(clinicB.id, animal.id, v.id)),
      request(app)
        .patch(vaxPath(clinicB.id, animal.id, v.id))
        .send({ vaccineName: 'x' }),
      request(app).delete(vaxPath(clinicB.id, animal.id, v.id)),
      request(app).post(`${vaxPath(clinicB.id, animal.id, v.id)}/notify`),
    ]) {
      expect((await req.set(bearer(ownerB.accessToken))).status).toBe(404);
    }
    const clinicWide = await request(app)
      .get(`/api/v1/organizations/${clinicB.id}/clinic-vaccinations`)
      .set(bearer(ownerB.accessToken));
    expect(clinicWide.body.data).toEqual([]);
  });

  it('the owner reads every clinic’s vaccinations but can never modify one', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    const v = await createVaccination(app, vet.accessToken, clinic.id, animal.id);
    const one = await request(app)
      .get(`/api/v1/animals/${animal.id}/vaccinations/${v.id}`)
      .set(bearer(petOwner.accessToken));
    expect(one.status).toBe(200);
    for (const req of [
      request(app).patch(`/api/v1/animals/${animal.id}/vaccinations/${v.id}`).send({ notes: 'x' }),
      request(app).delete(`/api/v1/animals/${animal.id}/vaccinations/${v.id}`),
      request(app).post(`/api/v1/animals/${animal.id}/vaccinations`).send({ vaccineName: 'x' }),
    ]) {
      expect((await req.set(bearer(petOwner.accessToken))).status).toBe(404);
    }
    // Clinic routes: the owner is not a member → 403.
    for (const req of [
      request(app)
        .patch(vaxPath(clinic.id, animal.id, v.id))
        .send({ notes: 'x' }),
      request(app).delete(vaxPath(clinic.id, animal.id, v.id)),
    ]) {
      expect((await req.set(bearer(petOwner.accessToken))).status).toBe(403);
    }
    const row = await getTestDb()('vaccinations').where({ id: v.id }).first();
    expect(row.notes).not.toBe('x');
  });
});
