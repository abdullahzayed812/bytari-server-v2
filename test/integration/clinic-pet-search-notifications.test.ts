import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
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

/**
 * Clinic Dashboard — the clinic's own pets (record-derived) search, open by
 * short ID / QR, owner pet-care notifications (owner-visible kinds only) and
 * the Pet Details per-section "new" counters.
 */
const { app, container } = buildTestApp();
const API = '/api/v1';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const clinicOwner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const otherClinicOwner = await registerApprovedVet(app);
  const petOwner = await registerUser(app, { firstName: 'Zainab', lastName: 'Kareem' });
  const otherPetOwner = await registerUser(app, { firstName: 'Omar', lastName: 'Saleh' });
  await container.db('users').where({ id: petOwner.id }).update({ phone: '+9647701234567' });
  const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Search Clinic',
  });
  const otherClinic = await createActiveOrganization(
    app,
    otherClinicOwner.accessToken,
    admin.accessToken,
    { type: 'CLINIC', name: 'Other Clinic' },
  );
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  const milo = await createAnimal(app, petOwner.accessToken, { name: 'Milo', breed: 'Husky' });
  const luna = await createAnimal(app, petOwner.accessToken, { name: 'Luna', breed: 'Persian' });
  const rex = await createAnimal(app, otherPetOwner.accessToken, { name: 'Rex' });
  // Milo + Luna are pets of `clinic` (it recorded something for them); Rex is
  // a pet of the OTHER clinic only. Private records → no owner notification.
  await openClinicPet(app, clinicOwner.accessToken, clinic.id, milo.publicCode);
  await createMedicalRecord(app, clinicOwner.accessToken, clinic.id, milo.id);
  await openClinicPet(app, clinicOwner.accessToken, clinic.id, luna.publicCode);
  await createMedicalRecord(app, clinicOwner.accessToken, clinic.id, luna.id);
  await openClinicPet(app, otherClinicOwner.accessToken, otherClinic.id, rex.publicCode);
  await createMedicalRecord(app, otherClinicOwner.accessToken, otherClinic.id, rex.id, {
    diagnosis: 'Other clinic private diagnosis',
  });
  return {
    clinicOwner,
    vet,
    otherClinicOwner,
    petOwner,
    otherPetOwner,
    clinic,
    otherClinic,
    milo,
    luna,
    rex,
  };
}

/** An adoption / mating / lost listing subject — never an owned pet profile. */
async function createListingAnimal(token: string, name: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/animals`)
    .set(bearer(token))
    .send({ name, species: 'CAT', listingOnly: true });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

const search = (orgId: string, token: string, term: string) =>
  request(app)
    .get(`${API}/organizations/${orgId}/clinic-pets`)
    .query({ search: term })
    .set(bearer(token));
const names = (res: request.Response): string[] =>
  (res.body.data as Array<{ animal: { name: string } }>).map((i) => i.animal.name).sort();

describe('clinic owned-pet search', () => {
  it('matches name, breed, owner name, owner phone, short id and full id — this clinic’s patients only', async () => {
    const { vet, clinic, milo, rex } = await setup();

    expect(names(await search(clinic.id, vet.accessToken, 'mil'))).toEqual(['Milo']);
    expect(names(await search(clinic.id, vet.accessToken, 'persian'))).toEqual(['Luna']);
    expect(names(await search(clinic.id, vet.accessToken, 'Zainab Kar'))).toEqual(['Luna', 'Milo']);
    expect(names(await search(clinic.id, vet.accessToken, '7701234'))).toEqual(['Luna', 'Milo']);
    // Short public ID: exact, any case, with or without the dash.
    const code = milo.publicCode;
    expect(names(await search(clinic.id, vet.accessToken, code))).toEqual(['Milo']);
    const dashed = `${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase();
    expect(names(await search(clinic.id, vet.accessToken, dashed))).toEqual(['Milo']);
    expect(names(await search(clinic.id, vet.accessToken, milo.id))).toEqual(['Milo']);

    // No results / another clinic's patient — by name and by exact id.
    expect(names(await search(clinic.id, vet.accessToken, 'nothing-like-this'))).toEqual([]);
    expect(names(await search(clinic.id, vet.accessToken, 'Rex'))).toEqual([]);
    expect(names(await search(clinic.id, vet.accessToken, rex.id))).toEqual([]);
    expect(names(await search(clinic.id, vet.accessToken, rex.publicCode))).toEqual([]);

    // Result cards carry the owner + photo field (no photo uploaded → null).
    const res = await search(clinic.id, vet.accessToken, 'Milo');
    expect(res.body.data[0]).toMatchObject({
      animalId: milo.id,
      publicCode: milo.publicCode,
      ownerName: 'Zainab Kareem',
      animal: { name: 'Milo', breed: 'Husky', photoUrl: null },
      firstActivityAt: expect.any(String),
      lastActivityAt: expect.any(String),
    });
  });

  it('a non-member cannot search the clinic’s patients', async () => {
    const { otherClinicOwner, clinic } = await setup();
    const res = await search(clinic.id, otherClinicOwner.accessToken, 'Milo');
    expect([403, 404]).toContain(res.status);
  });

  it('listing subjects (adoption / mating / lost) can never become clinic patients', async () => {
    const { clinicOwner, vet, petOwner, clinic } = await setup();
    const listingId = await createListingAnimal(petOwner.accessToken, 'Adoptee');
    const listing = await container.db('animals').where({ id: listingId }).first();

    // Not openable by code or UUID…
    for (const code of [listing.public_code, listingId]) {
      const lookup = await request(app)
        .get(`${API}/organizations/${clinic.id}/clinic-pets/lookup`)
        .query({ code })
        .set(bearer(vet.accessToken));
      expect(lookup.status).toBe(404);
    }
    // …and even a legacy row for it (old grant / record) never lists it.
    await container.db('animal_clinic_access').insert({
      animal_id: listingId,
      organization_id: clinic.id,
      status: 'ACTIVE',
      granted_by_user_id: clinicOwner.id,
    });
    await container.db('medical_records').insert({
      animal_id: listingId,
      organization_id: clinic.id,
      recorded_by_user_id: clinicOwner.id,
      diagnosis: 'legacy',
    });
    expect(names(await search(clinic.id, vet.accessToken, 'Adoptee'))).toEqual([]);
    expect(names(await search(clinic.id, vet.accessToken, listingId))).toEqual([]);
    const profile = await request(app)
      .get(`${API}/organizations/${clinic.id}/animals/${listingId}`)
      .set(bearer(vet.accessToken));
    expect(profile.status).toBe(404);
    const record = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${listingId}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'x' });
    expect(record.status).toBe(404);
  });

  it('opens ANY registered pet by short ID / legacy UUID / link — without exposing another clinic’s work', async () => {
    const { vet, clinic, rex } = await setup();
    const lookup = (code: string) =>
      request(app)
        .get(`${API}/organizations/${clinic.id}/clinic-pets/lookup`)
        .query({ code })
        .set(bearer(vet.accessToken));

    const byCode = await lookup(`${rex.publicCode.slice(0, 3)}-${rex.publicCode.slice(3)}`);
    expect(byCode.status).toBe(200);
    expect(byCode.body.data).toEqual({
      animalId: rex.id,
      publicCode: rex.publicCode,
      name: 'Rex',
      species: expect.any(String),
      breed: null,
      photoUrl: null,
      workedWith: false,
    });
    expect((await lookup(rex.publicCode.toLowerCase())).body.data.animalId).toBe(rex.id);
    // Old QR codes encode the UUID (sometimes inside a link) — still resolve.
    expect((await lookup(rex.id)).body.data.animalId).toBe(rex.id);
    expect((await lookup(`https://bytari.app/pets/${rex.id}`)).body.data.animalId).toBe(rex.id);
    // Every lookup is audited (who opened which pet, from which clinic).
    const audits = await container
      .db('audit_logs')
      .where({ action: 'CLINIC_PET_LOOKED_UP', entity_id: rex.id })
      .whereRaw(`metadata->>'organizationId' = ?`, [clinic.id]);
    expect(audits).toHaveLength(4);

    // Opening links nothing and reveals nothing of the other clinic's records.
    const profile = await request(app)
      .get(`${API}/organizations/${clinic.id}/animals/${rex.id}`)
      .set(bearer(vet.accessToken));
    expect(profile.status).toBe(200);
    expect(profile.body.data.relationship).toBeNull();
    expect(profile.body.data.stats.medicalRecordsCount).toBe(0);
    const records = await request(app)
      .get(`${API}/organizations/${clinic.id}/animals/${rex.id}/medical-records`)
      .set(bearer(vet.accessToken));
    expect(records.body.data).toEqual([]);
    expect(JSON.stringify([profile.body, records.body])).not.toContain('Other clinic private');
    expect(names(await search(clinic.id, vet.accessToken, 'Rex'))).toEqual([]);

    // Unknown / malformed codes are one neutral 404.
    const unknown = await lookup('ZZZZZZZ');
    expect(unknown.status).toBe(404);
    expect((await lookup('not a code')).status).toBe(404);
    expect((await lookup('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

const ownerNotes = (userId: string, type: string) =>
  container.db('notifications').where({ recipient_user_id: userId, type });

describe('owner pet-care notifications', () => {
  it('clinic-private medical records (drafts or final) never notify the owner', async () => {
    const { vet, petOwner, clinic, milo } = await setup();
    const res = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${milo.id}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'Secret diagnosis', treatment: 'Secret treatment' });
    expect(res.status).toBe(201);
    const draft = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${milo.id}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'wip', isDraft: true });
    await request(app)
      .patch(
        `${API}/organizations/${clinic.id}/animals/${milo.id}/medical-records/${draft.body.data.id}`,
      )
      .set(bearer(vet.accessToken))
      .send({ isDraft: false })
      .expect(200);
    await tick();
    await tick();
    expect(await ownerNotes(petOwner.id, 'MEDICAL_RECORD_ADDED')).toHaveLength(0);
    const all = await container.db('notifications').where({ recipient_user_id: petOwner.id });
    expect(JSON.stringify(all)).not.toMatch(/Secret/);
  });

  it('owner-visible additions (vaccination, reminder) notify ONLY the current owner, without medical details', async () => {
    const { vet, petOwner, otherPetOwner, clinicOwner, clinic, milo } = await setup();
    const v = await createVaccination(app, vet.accessToken, clinic.id, milo.id, {
      vaccineName: 'Rabies',
    });
    const r = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${milo.id}/reminders`)
      .set(bearer(vet.accessToken))
      .send({ title: 'checkup', reminderDate: '2099-01-01', reminderType: 'CHECKUP' });
    expect(r.status).toBe(201);
    for (let i = 0; i < 40; i += 1) {
      const n = await container.db('notifications').where({ recipient_user_id: petOwner.id });
      if (n.length >= 2) break;
      await tick();
    }
    const vax = await ownerNotes(petOwner.id, 'VACCINATION_ADDED');
    expect(vax).toHaveLength(1);
    expect(vax[0]).toMatchObject({ entity_type: 'VACCINATION', entity_id: v.id });
    expect(vax[0].data).toMatchObject({ animalId: milo.id, organizationId: clinic.id });
    expect(vax[0].body).toContain('Milo');
    expect(vax[0].body).toContain('Search Clinic');
    expect(await ownerNotes(petOwner.id, 'REMINDER_ADDED')).toHaveLength(1);
    for (const other of [otherPetOwner.id, vet.id, clinicOwner.id]) {
      expect(await ownerNotes(other, 'VACCINATION_ADDED')).toHaveLength(0);
    }
  });

  it('a failed create sends nothing; a replayed event is deduplicated', async () => {
    const { vet, petOwner, clinic, milo } = await setup();
    const bad = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${milo.id}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ severity: 'NOT_A_SEVERITY' });
    expect(bad.status).toBe(422);
    await tick();
    expect(await ownerNotes(petOwner.id, 'MEDICAL_RECORD_ADDED')).toHaveLength(0);

    const v = await createVaccination(app, vet.accessToken, clinic.id, milo.id, {
      vaccineName: 'Rabies',
    });
    await tick();
    const payload = {
      vaccinationId: v.id,
      animalId: milo.id,
      organizationId: clinic.id,
      petOwnerUserId: petOwner.id,
      actorUserId: vet.id,
    };
    container.eventBus.publish('vaccination.created', payload);
    container.eventBus.publish('vaccination.created', payload);
    await tick();
    expect(await ownerNotes(petOwner.id, 'VACCINATION_ADDED')).toHaveLength(1);
  });
});

describe('Pet Details per-section "new" counters', () => {
  const unseen = (token: string, animalId: string) =>
    request(app).get(`${API}/notifications/pets/${animalId}/unseen`).set(bearer(token));
  const seen = (token: string, animalId: string, section: string) =>
    request(app)
      .post(`${API}/notifications/pets/${animalId}/seen`)
      .set(bearer(token))
      .send({ section });

  it('counts unseen clinic additions per section; opening one section clears only that one', async () => {
    const { vet, petOwner, otherPetOwner, clinic, milo, luna } = await setup();
    const base = `${API}/organizations/${clinic.id}/animals/${milo.id}`;
    // Private records add nothing to the owner's counters.
    await request(app)
      .post(`${base}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'a' });
    await createVaccination(app, vet.accessToken, clinic.id, milo.id, { vaccineName: 'Rabies' });
    const reminder = await request(app)
      .post(`${base}/reminders`)
      .set(bearer(vet.accessToken))
      .send({ title: 'checkup', reminderDate: '2099-01-01', reminderType: 'CHECKUP' });
    expect(reminder.status).toBe(201);
    // Luna (another pet of the same owner) has its own counters.
    await createVaccination(app, vet.accessToken, clinic.id, luna.id, { vaccineName: 'FVRCP' });
    await tick();

    const before = await unseen(petOwner.accessToken, milo.id);
    expect(before.status).toBe(200);
    expect(before.body.data).toEqual({ vaccinations: 1, reminders: 1 });
    expect((await unseen(petOwner.accessToken, luna.id)).body.data).toEqual({
      vaccinations: 1,
      reminders: 0,
    });

    const cleared = await seen(petOwner.accessToken, milo.id, 'vaccinations');
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toEqual({ updated: 1 });
    expect((await unseen(petOwner.accessToken, milo.id)).body.data).toEqual({
      vaccinations: 0,
      reminders: 1,
    });
    // Idempotent; other pets untouched.
    expect((await seen(petOwner.accessToken, milo.id, 'vaccinations')).body.data).toEqual({
      updated: 0,
    });
    expect((await unseen(petOwner.accessToken, luna.id)).body.data.vaccinations).toBe(1);

    // Integrated with the normal read state: the global unread count drops too.
    const unread = await request(app)
      .get(`${API}/notifications/unread-count`)
      .set(bearer(petOwner.accessToken));
    expect(unread.body.data.count).toBe(2);

    // Someone else only ever sees their own (empty) counters for this pet.
    expect((await unseen(otherPetOwner.accessToken, milo.id)).body.data).toEqual({
      vaccinations: 0,
      reminders: 0,
    });
    expect((await seen(otherPetOwner.accessToken, milo.id, 'reminders')).body.data).toEqual({
      updated: 0,
    });
    expect((await unseen(petOwner.accessToken, milo.id)).body.data.reminders).toBe(1);
  });

  it('validates the section and the pet id', async () => {
    const { petOwner, milo } = await setup();
    expect((await seen(petOwner.accessToken, milo.id, 'everything')).status).toBe(422);
    // There is no owner "medical records" section any more.
    expect((await seen(petOwner.accessToken, milo.id, 'medicalRecords')).status).toBe(422);
    expect((await unseen(petOwner.accessToken, 'not-a-uuid')).status).toBe(422);
    expect((await request(app).get(`${API}/notifications/pets/${milo.id}/unseen`)).status).toBe(
      401,
    );
  });
});
