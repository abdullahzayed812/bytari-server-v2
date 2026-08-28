import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  createAnimal,
  createMedicalRecord,
  grantVeterinaryAccess,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  transferAnimal,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const clinicOwner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const outsiderVet = await registerApprovedVet(app);
  const petOwner = await registerUser(app);
  const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Clinic A',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Milo' });
  await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, animal.id);
  return { admin, clinicOwner, vet, outsiderVet, petOwner, clinic, animal };
}

const recPath = (clinicId: string, animalId: string, id?: string): string =>
  `/api/v1/organizations/${clinicId}/animals/${animalId}/medical-records${id ? `/${id}` : ''}`;

describe('medical records — clinic CRUD', () => {
  it('an authorized clinic veterinarian can create, read, update and delete', async () => {
    const { vet, clinic, animal } = await setup();

    const create = await request(app)
      .post(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken))
      .send({ reason: 'Limping', diagnosis: 'Sprain', treatment: 'Rest', notes: 'recheck 1w' });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({
      animalId: animal.id,
      organizationId: clinic.id,
      recordedByUserId: vet.id,
      diagnosis: 'Sprain',
    });

    const read = await request(app)
      .get(recPath(clinic.id, animal.id, id))
      .set(bearer(vet.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data.reason).toBe('Limping');

    const list = await request(app).get(recPath(clinic.id, animal.id)).set(bearer(vet.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const upd = await request(app)
      .patch(recPath(clinic.id, animal.id, id))
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'Fracture' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.diagnosis).toBe('Fracture');

    const del = await request(app)
      .delete(recPath(clinic.id, animal.id, id))
      .set(bearer(vet.accessToken));
    expect(del.status).toBe(200);

    const after = await request(app)
      .get(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken));
    expect(after.body.data).toHaveLength(0);
  });

  it('rejects a create when the clinic has no veterinary-access grant (404)', async () => {
    const { vet, clinic, animal } = await setup();
    // revoke the grant created in setup
    await getTestDb()('animal_clinic_access')
      .where({ animal_id: animal.id, organization_id: clinic.id })
      .update({ status: 'REVOKED' });

    const res = await request(app)
      .post(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'x' });
    expect(res.status).toBe(404);
    expect(await getTestDb()('medical_records')).toHaveLength(0);
  });

  it('rejects an empty create body and an empty patch body with 422', async () => {
    const { vet, clinic, animal } = await setup();
    const emptyCreate = await request(app)
      .post(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken))
      .send({});
    expect(emptyCreate.status).toBe(422);

    const rec = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    const emptyPatch = await request(app)
      .patch(recPath(clinic.id, animal.id, rec.id))
      .set(bearer(vet.accessToken))
      .send({});
    expect(emptyPatch.status).toBe(422);
  });

  it('refuses writes for a DEACTIVATED animal with 409 but still allows reads', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    const rec = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    await request(app).delete(`/api/v1/animals/${animal.id}`).set(bearer(petOwner.accessToken));

    const write = await request(app)
      .post(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'later' });
    expect(write.status).toBe(409);
    expect(write.body.error.code).toBe('ANIMAL_NOT_ACTIVE');

    const read = await request(app)
      .get(recPath(clinic.id, animal.id, rec.id))
      .set(bearer(vet.accessToken));
    expect(read.status).toBe(200);
  });
});

describe('medical records — authorization separation', () => {
  it('denies a veterinarian who is not a member of the clinic (403)', async () => {
    const { outsiderVet, clinic, animal } = await setup();
    const res = await request(app)
      .get(recPath(clinic.id, animal.id))
      .set(bearer(outsiderVet.accessToken));
    // authorizeOrg denies a non-member before the access gate → 403
    expect(res.status).toBe(403);
  });

  it('denies a random authenticated user (403 — not a clinic member)', async () => {
    const { clinic, animal } = await setup();
    const stranger = await registerUser(app);
    const res = await request(app)
      .get(recPath(clinic.id, animal.id))
      .set(bearer(stranger.accessToken));
    expect(res.status).toBe(403);
  });

  it('does not let the animal OWNER use the clinic write routes (403 — not a clinic member)', async () => {
    const { petOwner, clinic, animal } = await setup();
    const res = await request(app)
      .post(recPath(clinic.id, animal.id))
      .set(bearer(petOwner.accessToken))
      .send({ diagnosis: 'self-diagnosis' });
    expect(res.status).toBe(403);
  });

  it('lets an ADMIN operate on any clinic/animal even without a grant', async () => {
    const { admin, clinic, animal } = await setup();
    await getTestDb()('animal_clinic_access')
      .where({ animal_id: animal.id })
      .update({ status: 'REVOKED' });
    const res = await request(app)
      .post(recPath(clinic.id, animal.id))
      .set(bearer(admin.accessToken))
      .send({ diagnosis: 'admin note' });
    expect(res.status).toBe(201);
  });

  it('respects an org SUPERVISOR’s explicitly-assigned permissions', async () => {
    const { admin, clinicOwner, clinic, animal } = await setup();
    const supervisor = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, clinicOwner.accessToken, clinic.id, {
      userId: supervisor.id,
      permissions: ['medical_record.read'],
    });
    void admin;

    const read = await request(app)
      .get(recPath(clinic.id, animal.id))
      .set(bearer(supervisor.accessToken));
    expect(read.status).toBe(200);

    // no medical_record.create in the assigned set → denied
    const write = await request(app)
      .post(recPath(clinic.id, animal.id))
      .set(bearer(supervisor.accessToken))
      .send({ diagnosis: 'nope' });
    expect(write.status).toBe(403);
  });
});

describe('medical records — cross-organization isolation', () => {
  it('a second clinic with no grant cannot see the animal’s records (404)', async () => {
    const { admin, vet, clinic, animal } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);

    const ownerB = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic B',
    });
    await addOrganizationMember(app, ownerB.accessToken, clinicB.id, {
      userId: vetB.id,
      role: 'VETERINARIAN',
    });

    const res = await request(app)
      .get(recPath(clinicB.id, animal.id))
      .set(bearer(vetB.accessToken));
    expect(res.status).toBe(404);
  });

  it('a clinic WITH a grant sees the full history but cannot edit another clinic’s record', async () => {
    const { admin, vet, clinicOwner, clinic, animal } = await setup();
    const recA = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      diagnosis: 'A-diag',
    });

    const ownerB = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic B',
    });
    await addOrganizationMember(app, ownerB.accessToken, clinicB.id, {
      userId: vetB.id,
      role: 'VETERINARIAN',
    });
    await grantVeterinaryAccess(app, ownerB.accessToken, clinicB.id, animal.id);
    void clinicOwner;

    // full history visible to clinic B
    const list = await request(app)
      .get(recPath(clinicB.id, animal.id))
      .set(bearer(vetB.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].diagnosis).toBe('A-diag');

    // but clinic B cannot mutate clinic A's record
    const patch = await request(app)
      .patch(recPath(clinicB.id, animal.id, recA.id))
      .set(bearer(vetB.accessToken))
      .send({ diagnosis: 'tampered' });
    expect(patch.status).toBe(404);

    const del = await request(app)
      .delete(recPath(clinicB.id, animal.id, recA.id))
      .set(bearer(vetB.accessToken));
    expect(del.status).toBe(404);
  });

  it('a wrong recordId for the animal returns 404 (IDOR guard)', async () => {
    const { admin, vet, clinic, animal } = await setup();
    const petOwner2 = await registerUser(app);
    const otherAnimal = await createAnimal(app, petOwner2.accessToken);
    await grantVeterinaryAccess(app, admin.accessToken, clinic.id, otherAnimal.id);
    const recOther = await createMedicalRecord(app, admin.accessToken, clinic.id, otherAnimal.id);

    const res = await request(app)
      .get(recPath(clinic.id, animal.id, recOther.id))
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('medical records — owner-facing read + ownership transfer', () => {
  it('the current owner can read the full history but cannot write', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, { diagnosis: 'D1' });

    const list = await request(app)
      .get(`/api/v1/animals/${animal.id}/medical-records`)
      .set(bearer(petOwner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].diagnosis).toBe('D1');

    // there is no owner-facing write route
    const write = await request(app)
      .post(`/api/v1/animals/${animal.id}/medical-records`)
      .set(bearer(petOwner.accessToken))
      .send({ diagnosis: 'x' });
    expect(write.status).toBe(404);
  });

  it('a non-owner cannot read another owner’s animal medical history (404)', async () => {
    const { vet, clinic, animal } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    const stranger = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/animals/${animal.id}/medical-records`)
      .set(bearer(stranger.accessToken));
    expect(res.status).toBe(404);
  });

  it('ownership transfer does NOT delete or alter medical history; new owner inherits read access', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    const rec = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      diagnosis: 'chronic',
    });
    const newOwner = await registerUser(app);

    await transferAnimal(app, petOwner.accessToken, animal.id, newOwner.id);

    // history row unchanged
    const row = (await getTestDb()('medical_records').where({ id: rec.id }).first()) as {
      diagnosis: string;
      animal_id: string;
    };
    expect(row).toMatchObject({ diagnosis: 'chronic', animal_id: animal.id });

    // previous owner loses access, new owner gains it
    const oldOwnerRead = await request(app)
      .get(`/api/v1/animals/${animal.id}/medical-records`)
      .set(bearer(petOwner.accessToken));
    expect(oldOwnerRead.status).toBe(404);

    const newOwnerRead = await request(app)
      .get(`/api/v1/animals/${animal.id}/medical-records`)
      .set(bearer(newOwner.accessToken));
    expect(newOwnerRead.status).toBe(200);
    expect(newOwnerRead.body.data).toHaveLength(1);

    // the clinic's records + access grant are untouched by the transfer
    const clinicRead = await request(app)
      .get(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken));
    expect(clinicRead.status).toBe(200);
    expect(clinicRead.body.data).toHaveLength(1);
  });
});
