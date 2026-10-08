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
  openClinicPet,
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
  await openClinicPet(app, clinicOwner.accessToken, clinic.id, animal.publicCode);
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

  it('needs no link: a clinic works on a pet straight after opening it (and never via a client clinicId)', async () => {
    const { vet, clinic, animal } = await setup();
    expect(await getTestDb()('animal_clinic_access')).toHaveLength(0); // nothing was linked
    const res = await request(app)
      .post(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken))
      // a smuggled organizationId / recordedByUserId is ignored (stripped / not trusted)
      .send({ diagnosis: 'x', organizationId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(201);
    expect(res.body.data.organizationId).toBe(clinic.id);
    expect(res.body.data.recordedByUserId).toBe(vet.id);
  });

  it('404s an unknown animal (no existence leak) and writes nothing', async () => {
    const { vet, clinic } = await setup();
    const res = await request(app)
      .post(recPath(clinic.id, '00000000-0000-4000-8000-000000000000'))
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

  it('lets an ADMIN operate as the URL clinic', async () => {
    const { admin, clinic, animal } = await setup();
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

async function secondClinic(admin: { accessToken: string }) {
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
  return { ownerB, vetB, clinicB };
}

describe('medical records — clinic isolation', () => {
  it('Clinic A sees / edits / deletes its own record; Clinic B can do none of that', async () => {
    const { admin, vet, clinic, animal } = await setup();
    const recA = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      diagnosis: 'A-diag',
      notes: 'A private note',
    });
    const { ownerB, vetB, clinicB } = await secondClinic(admin);
    await openClinicPet(app, ownerB.accessToken, clinicB.id, animal.publicCode);

    // Clinic B: list is empty, direct id is 404 — read, update and delete.
    const listB = await request(app)
      .get(recPath(clinicB.id, animal.id))
      .set(bearer(vetB.accessToken));
    expect(listB.status).toBe(200);
    expect(listB.body.data).toEqual([]);
    const getB = await request(app)
      .get(recPath(clinicB.id, animal.id, recA.id))
      .set(bearer(vetB.accessToken));
    expect(getB.status).toBe(404);
    const patchB = await request(app)
      .patch(recPath(clinicB.id, animal.id, recA.id))
      .set(bearer(vetB.accessToken))
      .send({ diagnosis: 'tampered' });
    expect(patchB.status).toBe(404);
    const delB = await request(app)
      .delete(recPath(clinicB.id, animal.id, recA.id))
      .set(bearer(vetB.accessToken));
    expect(delB.status).toBe(404);
    // Clinic B's own timeline does not contain it either.
    const timelineB = await request(app)
      .get(`/api/v1/organizations/${clinicB.id}/animals/${animal.id}/medical-history`)
      .set(bearer(vetB.accessToken));
    expect(timelineB.body.data).toEqual([]);
    expect(JSON.stringify([listB.body, timelineB.body])).not.toContain('A private note');

    // Clinic B records its own; each clinic sees exactly its own.
    const recB = await createMedicalRecord(app, vetB.accessToken, clinicB.id, animal.id, {
      diagnosis: 'B-diag',
    });
    const listA = await request(app)
      .get(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken));
    expect(listA.body.data.map((r: { id: string }) => r.id)).toEqual([recA.id]);
    const listB2 = await request(app)
      .get(recPath(clinicB.id, animal.id))
      .set(bearer(vetB.accessToken));
    expect(listB2.body.data.map((r: { id: string }) => r.id)).toEqual([recB.id]);
    const getAofB = await request(app)
      .get(recPath(clinic.id, animal.id, recB.id))
      .set(bearer(vet.accessToken));
    expect(getAofB.status).toBe(404);

    // Clinic A still fully controls its own record.
    const patchA = await request(app)
      .patch(recPath(clinic.id, animal.id, recA.id))
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'A-diag-2' });
    expect(patchA.status).toBe(200);
    const row = await getTestDb()('medical_records').where({ id: recA.id }).first();
    expect(row.diagnosis).toBe('A-diag-2');
    const delA = await request(app)
      .delete(recPath(clinic.id, animal.id, recA.id))
      .set(bearer(vet.accessToken));
    expect(delA.status).toBe(200);
    expect(await getTestDb()('medical_records').where({ id: recB.id }).first()).toBeDefined();
  });

  it('a member of BOTH clinics sees each clinic’s records only under that clinic', async () => {
    const { admin, clinicOwner, vet, clinic, animal } = await setup();
    const { ownerB, clinicB } = await secondClinic(admin);
    await addOrganizationMember(app, ownerB.accessToken, clinicB.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    const recA = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    void clinicOwner;
    const viaB = await request(app)
      .get(recPath(clinicB.id, animal.id, recA.id))
      .set(bearer(vet.accessToken));
    expect(viaB.status).toBe(404);
    const patchViaB = await request(app)
      .patch(recPath(clinicB.id, animal.id, recA.id))
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'x' });
    expect(patchViaB.status).toBe(404);
  });

  it('a wrong recordId for the animal returns 404 (IDOR guard)', async () => {
    const { admin, vet, clinic, animal } = await setup();
    const petOwner2 = await registerUser(app);
    const otherAnimal = await createAnimal(app, petOwner2.accessToken);
    await openClinicPet(app, admin.accessToken, clinic.id, otherAnimal.publicCode);
    const recOther = await createMedicalRecord(app, admin.accessToken, clinic.id, otherAnimal.id);

    const res = await request(app)
      .get(recPath(clinic.id, animal.id, recOther.id))
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('medical records — clinic-private: the owner never sees them', () => {
  it('the owner has no read or write route for clinic medical records', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    const rec = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      diagnosis: 'D1',
    });

    for (const path of [
      `/api/v1/animals/${animal.id}/medical-records`,
      `/api/v1/animals/${animal.id}/medical-records/${rec.id}`,
    ]) {
      const res = await request(app).get(path).set(bearer(petOwner.accessToken));
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('D1');
    }
    const write = await request(app)
      .post(`/api/v1/animals/${animal.id}/medical-records`)
      .set(bearer(petOwner.accessToken))
      .send({ diagnosis: 'x' });
    expect(write.status).toBe(404);
    // …and the owner cannot reach the clinic routes either (not a member).
    for (const req of [
      request(app).get(recPath(clinic.id, animal.id, rec.id)),
      request(app)
        .patch(recPath(clinic.id, animal.id, rec.id))
        .send({ diagnosis: 'x' }),
      request(app).delete(recPath(clinic.id, animal.id, rec.id)),
    ]) {
      expect((await req.set(bearer(petOwner.accessToken))).status).toBe(403);
    }
    // The owner's pet profile + timeline carry no record content.
    const pet = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(petOwner.accessToken));
    const timeline = await request(app)
      .get(`/api/v1/animals/${animal.id}/medical-history`)
      .set(bearer(petOwner.accessToken));
    expect(timeline.status).toBe(200);
    expect(timeline.body.data).toEqual([]);
    expect(JSON.stringify([pet.body, timeline.body])).not.toContain('D1');
  });

  it('ownership transfer does NOT delete or alter the clinic’s records', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    const rec = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      diagnosis: 'chronic',
    });
    const newOwner = await registerUser(app);

    await transferAnimal(app, petOwner.accessToken, animal.id, newOwner.id, newOwner.accessToken);

    const row = (await getTestDb()('medical_records').where({ id: rec.id }).first()) as {
      diagnosis: string;
      animal_id: string;
    };
    expect(row).toMatchObject({ diagnosis: 'chronic', animal_id: animal.id });

    const clinicRead = await request(app)
      .get(recPath(clinic.id, animal.id))
      .set(bearer(vet.accessToken));
    expect(clinicRead.status).toBe(200);
    expect(clinicRead.body.data).toHaveLength(1);
  });
});
