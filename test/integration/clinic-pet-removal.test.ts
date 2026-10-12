import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createAnimal,
  openClinicPet,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

/**
 * "Remove pet from this clinic" — the full scenario over HTTP: the pet leaves
 * Clinic A's lists, the owner keeps the vaccination + reminder (anonymised),
 * the private record is archived (kept, never shown), Clinic B is untouched,
 * and Clinic A can open the same pet again and start over.
 */
const { app, container } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const owner = await registerUser(app, { firstName: 'Sara' });
  const ownerA = await registerApprovedVet(app);
  const vetA = await registerApprovedVet(app);
  const ownerB = await registerApprovedVet(app);
  const clinicA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Clinic Alpha',
  });
  const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Clinic Beta',
  });
  await addOrganizationMember(app, ownerA.accessToken, clinicA.id, {
    userId: vetA.id,
    role: 'VETERINARIAN',
  });
  const pet = await createAnimal(app, owner.accessToken, { name: 'Pet X' });
  return { admin, owner, ownerA, vetA, ownerB, clinicA, clinicB, pet };
}

describe('Clinic Dashboard — remove a pet from this clinic', () => {
  it('runs the full removal scenario end to end', async () => {
    const { owner, ownerA, vetA, ownerB, clinicA, clinicB, pet } = await setup();
    const a = `${API}/organizations/${clinicA.id}/animals/${pet.id}`;
    const b = `${API}/organizations/${clinicB.id}/animals/${pet.id}`;
    const asA = (r: request.Test) => r.set(bearer(vetA.accessToken));
    const asB = (r: request.Test) => r.set(bearer(ownerB.accessToken));
    const ownerGet = (path: string) =>
      request(app).get(`${API}/animals/${pet.id}${path}`).set(bearer(owner.accessToken));

    // 1. Clinic A adds a private record, a vaccination and a reminder.
    await openClinicPet(app, vetA.accessToken, clinicA.id, pet.publicCode);
    const rec = await asA(request(app).post(`${a}/medical-records`)).send({
      diagnosis: 'PRIVATE-DIAGNOSIS',
      notes: 'PRIVATE-NOTE',
    });
    expect(rec.status).toBe(201);
    const vax = await asA(request(app).post(`${a}/vaccinations`)).send({
      vaccineName: 'Rabies',
      administeredOn: '2026-10-01',
      nextDueOn: '2027-10-01',
    });
    expect(vax.status).toBe(201);
    const rem = await asA(request(app).post(`${a}/reminders`)).send({
      title: 'Booster',
      reminderDate: '2099-01-01',
      reminderType: 'VACCINATION',
    });
    expect(rem.status).toBe(201);

    // Clinic B has its own vaccination for the same pet — must stay untouched.
    await openClinicPet(app, ownerB.accessToken, clinicB.id, pet.publicCode);
    const vaxB = await asB(request(app).post(`${b}/vaccinations`)).send({
      vaccineName: 'Parvo',
      administeredOn: '2026-09-01',
    });
    expect(vaxB.status).toBe(201);

    // 2. Owner sees vaccination + reminder, not the private record.
    expect((await ownerGet('/vaccinations')).body.data).toHaveLength(2);
    expect((await ownerGet('/reminders')).body.data).toHaveLength(1);
    expect(JSON.stringify((await ownerGet('/medical-history')).body)).not.toMatch(/PRIVATE-/);
    // 3. Clinic B cannot see Clinic A's private record.
    expect((await asB(request(app).get(`${b}/medical-records`))).body.data).toEqual([]);

    // A plain clinic veterinarian may not remove; another clinic may not either (IDOR).
    await asA(
      request(app).delete(`${API}/organizations/${clinicA.id}/clinic-pets/${pet.id}`),
    ).expect(403);
    await request(app)
      .delete(`${API}/organizations/${clinicA.id}/clinic-pets/${pet.id}`)
      .set(bearer(ownerB.accessToken))
      .expect(403);

    // 4. Clinic A (owner) removes Pet X.
    const removed = await request(app)
      .delete(`${API}/organizations/${clinicA.id}/clinic-pets/${pet.id}`)
      .set(bearer(ownerA.accessToken))
      .expect(200);
    expect(removed.body.data).toMatchObject({
      animalId: pet.id,
      removed: true,
      detached: { medicalRecords: 1, vaccinations: 1, reminders: 1 },
    });

    // 5. Gone from Clinic A's Recent / All Pets; its private record is gone from
    // its pet file. The shared vaccination / reminder stay visible, anonymised and
    // read-only (detached rows belong to no clinic any more).
    const listA = await asA(request(app).get(`${API}/organizations/${clinicA.id}/clinic-pets`));
    expect(listA.body.data).toEqual([]);
    expect((await asA(request(app).get(`${a}/medical-records`))).body.data).toEqual([]);
    const aShared = (await asA(request(app).get(`${a}/vaccinations`))).body.data as Array<{
      id: string;
      organizationId: string | null;
    }>;
    expect(aShared.map((v) => v.id).sort()).toEqual([vax.body.data.id, vaxB.body.data.id].sort());
    expect(aShared.every((v) => v.organizationId === null)).toBe(true);
    expect((await asA(request(app).get(`${a}/reminders`))).body.data).toEqual([
      expect.objectContaining({
        id: rem.body.data.id,
        organizationId: null,
        recordedByUserId: null,
      }),
    ]);
    await asA(request(app).get(`${a}/medical-records/${rec.body.data.id}`)).expect(404);
    await asA(
      request(app).patch(`${a}/vaccinations/${vax.body.data.id}`).send({ notes: 'x' }),
    ).expect(403);
    await asA(request(app).delete(`${a}/reminders/${rem.body.data.id}`)).expect(403);

    // 6. The owner still owns and opens Pet X.
    const petRes = await ownerGet('').expect(200);
    expect(petRes.body.data.id).toBe(pet.id);

    // 7. + 9. Vaccination and reminder stay visible to the owner, without
    // Clinic A's identity or the veterinarian's.
    const ownerVax = (await ownerGet('/vaccinations')).body.data as Array<Record<string, unknown>>;
    const kept = ownerVax.find((v) => v.id === vax.body.data.id)!;
    expect(kept).toMatchObject({
      vaccineName: 'Rabies',
      organizationId: null,
      recordedByUserId: null,
    });
    const ownerRem = (await ownerGet('/reminders')).body.data as Array<Record<string, unknown>>;
    expect(ownerRem[0]).toMatchObject({
      id: rem.body.data.id,
      title: 'Booster',
      organizationId: null,
    });
    expect(ownerRem[0]!.recordedByUserId).toBeNull();
    const ownerSurfaces = await Promise.all([
      ownerGet('/vaccinations'),
      ownerGet('/reminders'),
      ownerGet('/medical-history'),
      ownerGet('/clinics'),
    ]);
    const surfaceJson = JSON.stringify(ownerSurfaces.map((r) => r.body));
    expect(surfaceJson).not.toContain(clinicA.id);
    expect(surfaceJson).not.toContain('Clinic Alpha');
    expect(surfaceJson).not.toContain(vetA.id);
    expect(surfaceJson).not.toMatch(/PRIVATE-/);
    // Clinic B (still attributed) remains on the owner's clinics tab.
    expect(surfaceJson).toContain('Clinic Beta');

    // 8. + 12. Other clinics: Clinic B keeps its own data (still attributed) and
    // keeps seeing Clinic A's shared vaccination — without any creator identity.
    const bVax = (await asB(request(app).get(`${b}/vaccinations`))).body.data as Array<{
      id: string;
      organizationId: string | null;
      recordedByUserId: string | null;
    }>;
    expect(bVax.find((v) => v.id === vaxB.body.data.id)?.organizationId).toBe(clinicB.id);
    expect(bVax.find((v) => v.id === vax.body.data.id)).toMatchObject({
      organizationId: null,
      recordedByUserId: null,
    });
    expect(JSON.stringify(bVax)).not.toContain(vetA.id);
    const listB = await asB(request(app).get(`${API}/organizations/${clinicB.id}/clinic-pets`));
    expect(listB.body.data.map((p: { animalId: string }) => p.animalId)).toEqual([pet.id]);
    expect(JSON.stringify((await asB(request(app).get(b))).body)).not.toMatch(/PRIVATE-/);

    // The private record is archived (retained server-side), not destroyed.
    const archived = await getTestDb()('medical_records').where({ id: rec.body.data.id }).first();
    expect(archived).toMatchObject({
      organization_id: null,
      removed_from_organization_id: clinicA.id,
      removed_recorded_by_user_id: vetA.id,
      removed_by_user_id: ownerA.id,
      diagnosis: 'PRIVATE-DIAGNOSIS',
    });
    const audit = await getTestDb()('audit_logs')
      .where({ action: 'CLINIC_PET_REMOVED', entity_id: pet.id })
      .first();
    expect(audit.actor_user_id).toBe(ownerA.id);

    // 10. Clinic A can find Pet X again.
    const reopened = await openClinicPet(app, vetA.accessToken, clinicA.id, pet.publicCode);
    expect(reopened).toMatchObject({ animalId: pet.id, workedWith: false });

    // 11. ...and add new information without a duplicate pet.
    const vax2 = await asA(request(app).post(`${a}/vaccinations`)).send({
      vaccineName: 'Distemper',
      administeredOn: '2026-10-05',
    });
    expect(vax2.status).toBe(201);
    expect(vax2.body.data.organizationId).toBe(clinicA.id);
    const listA2 = await asA(request(app).get(`${API}/organizations/${clinicA.id}/clinic-pets`));
    expect(listA2.body.data.map((p: { animalId: string }) => p.animalId)).toEqual([pet.id]);
    // Only the new row is Clinic A's again — the archived ones stay detached.
    const aVax = (await asA(request(app).get(`${a}/vaccinations`))).body.data as Array<{
      id: string;
      organizationId: string | null;
    }>;
    expect(aVax.filter((v) => v.organizationId === clinicA.id).map((v) => v.id)).toEqual([
      vax2.body.data.id,
    ]);
    expect(aVax).toHaveLength(3);
    expect(await getTestDb()('animals').where({ name: 'Pet X' })).toHaveLength(1);
  });

  it('a repeated removal, or one for a pet the clinic never worked with, is a 404', async () => {
    const { ownerA, vetA, clinicA, pet } = await setup();
    const url = `${API}/organizations/${clinicA.id}/clinic-pets/${pet.id}`;
    await request(app).delete(url).set(bearer(ownerA.accessToken)).expect(404);

    await openClinicPet(app, vetA.accessToken, clinicA.id, pet.publicCode);
    await request(app)
      .post(`${API}/organizations/${clinicA.id}/animals/${pet.id}/vaccinations`)
      .set(bearer(vetA.accessToken))
      .send({ vaccineName: 'Rabies', administeredOn: '2026-10-01' })
      .expect(201);
    await request(app).delete(url).set(bearer(ownerA.accessToken)).expect(200);
    await request(app).delete(url).set(bearer(ownerA.accessToken)).expect(404);
    await request(app)
      .delete(`${API}/organizations/${clinicA.id}/clinic-pets/not-a-uuid`)
      .set(bearer(ownerA.accessToken))
      .expect(422);
  });

  it('rolls back every detach when the transaction fails', async () => {
    const { ownerA, vetA, clinicA, pet } = await setup();
    await openClinicPet(app, vetA.accessToken, clinicA.id, pet.publicCode);
    const vax = await request(app)
      .post(`${API}/organizations/${clinicA.id}/animals/${pet.id}/vaccinations`)
      .set(bearer(vetA.accessToken))
      .send({ vaccineName: 'Rabies', administeredOn: '2026-10-01' })
      .expect(201);
    const spy = vi
      .spyOn(container.auditService, 'record')
      .mockRejectedValueOnce(new Error('audit store down'));
    const res = await request(app)
      .delete(`${API}/organizations/${clinicA.id}/clinic-pets/${pet.id}`)
      .set(bearer(ownerA.accessToken));
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await getTestDb()('vaccinations').where({ id: vax.body.data.id }).first()).toMatchObject(
      {
        organization_id: clinicA.id,
        removed_at: null,
      },
    );
    const list = await request(app)
      .get(`${API}/organizations/${clinicA.id}/clinic-pets`)
      .set(bearer(vetA.accessToken));
    expect(list.body.data).toHaveLength(1);
  });
});
