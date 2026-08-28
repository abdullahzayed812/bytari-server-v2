import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createAnimal,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  grantVeterinaryAccess,
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
    name: 'Test Clinic',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Milo' });
  return { admin, clinicOwner, vet, petOwner, clinic, animal };
}

describe('clinic ↔ animal veterinary access', () => {
  it('lets the clinic owner grant, list and revoke access (independent of ownership)', async () => {
    const { clinicOwner, clinic, animal } = await setup();

    const grant = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/animal-access`)
      .set(bearer(clinicOwner.accessToken))
      .send({ animalId: animal.id });
    expect(grant.status).toBe(201);
    expect(grant.body.data).toMatchObject({
      animalId: animal.id,
      organizationId: clinic.id,
      status: 'ACTIVE',
    });

    const list = await request(app)
      .get(`/api/v1/organizations/${clinic.id}/animal-access`)
      .set(bearer(clinicOwner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].animal).toMatchObject({ name: 'Milo' });

    const revoke = await request(app)
      .delete(`/api/v1/organizations/${clinic.id}/animal-access/${animal.id}`)
      .set(bearer(clinicOwner.accessToken));
    expect(revoke.status).toBe(200);

    const afterRevoke = await request(app)
      .get(`/api/v1/organizations/${clinic.id}/animal-access`)
      .set(bearer(clinicOwner.accessToken));
    expect(afterRevoke.body.data).toHaveLength(0);

    // history row preserved as REVOKED
    const rows = await getTestDb()('animal_clinic_access').where({ animal_id: animal.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'REVOKED' });
  });

  it('does NOT let a plain clinic VETERINARIAN grant access (needs access.manage)', async () => {
    const { vet, clinic, animal } = await setup();
    const res = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/animal-access`)
      .set(bearer(vet.accessToken))
      .send({ animalId: animal.id });
    expect(res.status).toBe(403);
  });

  it('rejects a grant for a non-CLINIC organization with 400', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Office',
    });
    const petOwner = await registerUser(app);
    const animal = await createAnimal(app, petOwner.accessToken);

    const res = await request(app)
      .post(`/api/v1/organizations/${office.id}/animal-access`)
      .set(bearer(owner.accessToken))
      .send({ animalId: animal.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });

  it('rejects a duplicate active grant with 409', async () => {
    const { clinicOwner, clinic, animal } = await setup();
    await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, animal.id);
    const dup = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/animal-access`)
      .set(bearer(clinicOwner.accessToken))
      .send({ animalId: animal.id });
    expect(dup.status).toBe(409);
  });

  it('404s when revoking access that was never granted', async () => {
    const { clinicOwner, clinic, animal } = await setup();
    const res = await request(app)
      .delete(`/api/v1/organizations/${clinic.id}/animal-access/${animal.id}`)
      .set(bearer(clinicOwner.accessToken));
    expect(res.status).toBe(404);
  });

  it('lets an ADMIN grant access to any clinic', async () => {
    const { admin, clinic, animal } = await setup();
    const res = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/animal-access`)
      .set(bearer(admin.accessToken))
      .send({ animalId: animal.id });
    expect(res.status).toBe(201);
  });

  it('enforces one ACTIVE grant per (animal, clinic) at the database level', async () => {
    const { clinicOwner, clinic, animal } = await setup();
    await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, animal.id);
    await expect(
      getTestDb()('animal_clinic_access').insert({
        animal_id: animal.id,
        organization_id: clinic.id,
        status: 'ACTIVE',
      }),
    ).rejects.toThrow();
  });
});
