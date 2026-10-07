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
  grantVeterinaryAccess,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

/**
 * Clinic Dashboard — owned-pet search / QR-ID lookup, owner pet-care
 * notifications and the Pet Details per-section "new" counters.
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
  await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, milo.id);
  await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, luna.id);
  // Rex is a patient of the OTHER clinic only.
  await grantVeterinaryAccess(app, otherClinicOwner.accessToken, otherClinic.id, rex.id);
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
    .get(`${API}/organizations/${orgId}/animal-access`)
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
    expect(names(await search(clinic.id, vet.accessToken, milo.id.slice(0, 8)))).toEqual(['Milo']);
    expect(names(await search(clinic.id, vet.accessToken, milo.id))).toEqual(['Milo']);

    // No results / another clinic's patient — by name and by exact id.
    expect(names(await search(clinic.id, vet.accessToken, 'nothing-like-this'))).toEqual([]);
    expect(names(await search(clinic.id, vet.accessToken, 'Rex'))).toEqual([]);
    expect(names(await search(clinic.id, vet.accessToken, rex.id))).toEqual([]);

    // Result cards carry the owner + photo field (no photo uploaded → null).
    const res = await search(clinic.id, vet.accessToken, 'Milo');
    expect(res.body.data[0]).toMatchObject({
      animalId: milo.id,
      ownerName: 'Zainab Kareem',
      animal: { name: 'Milo', breed: 'Husky', photoUrl: null },
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

    const grant = await request(app)
      .post(`${API}/organizations/${clinic.id}/animal-access`)
      .set(bearer(clinicOwner.accessToken))
      .send({ animalId: listingId });
    expect(grant.status).toBe(404);

    // Even a pre-existing grant row (legacy data) never exposes it.
    await container.db('animal_clinic_access').insert({
      animal_id: listingId,
      organization_id: clinic.id,
      status: 'ACTIVE',
      granted_by_user_id: clinicOwner.id,
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

  it('QR / id lookup of a pet without access is a plain 404 — no owner data leaks', async () => {
    const { vet, clinic, rex } = await setup();
    const res = await request(app)
      .get(`${API}/organizations/${clinic.id}/animals/${rex.id}`)
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Omar');
    const unknown = await request(app)
      .get(`${API}/organizations/${clinic.id}/animals/00000000-0000-4000-8000-000000000000`)
      .set(bearer(vet.accessToken));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code ?? unknown.body.code).toEqual(
      res.body.error?.code ?? res.body.code,
    );
  });
});

const ownerNotes = (userId: string, type: string) =>
  container.db('notifications').where({ recipient_user_id: userId, type });

describe('owner pet-care notifications', () => {
  it('a new medical record notifies ONLY the current owner, naming pet + clinic but no medical details', async () => {
    const { vet, petOwner, otherPetOwner, clinicOwner, clinic, milo } = await setup();
    const res = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${milo.id}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'Secret diagnosis', treatment: 'Secret treatment' });
    expect(res.status).toBe(201);
    await tick();

    const rows = await ownerNotes(petOwner.id, 'MEDICAL_RECORD_ADDED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity_type: 'MEDICAL_RECORD',
      entity_id: res.body.data.id,
      source_event_key: `medical_record.created:${res.body.data.id}`,
    });
    expect(rows[0].data).toMatchObject({ animalId: milo.id, organizationId: clinic.id });
    expect(rows[0].body).toContain('Milo');
    expect(rows[0].body).toContain('Search Clinic');
    expect(`${rows[0].title} ${rows[0].body}`).not.toMatch(/Secret/);
    expect(await ownerNotes(otherPetOwner.id, 'MEDICAL_RECORD_ADDED')).toHaveLength(0);
    expect(await ownerNotes(vet.id, 'MEDICAL_RECORD_ADDED')).toHaveLength(0);
    expect(await ownerNotes(clinicOwner.id, 'MEDICAL_RECORD_ADDED')).toHaveLength(0);
  });

  it('drafts stay silent; finalising the draft notifies once', async () => {
    const { vet, petOwner, clinic, milo } = await setup();
    const draft = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${milo.id}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'wip', isDraft: true });
    expect(draft.status).toBe(201);
    await tick();
    expect(await ownerNotes(petOwner.id, 'MEDICAL_RECORD_ADDED')).toHaveLength(0);

    const url = `${API}/organizations/${clinic.id}/animals/${milo.id}/medical-records/${draft.body.data.id}`;
    expect(
      (await request(app).patch(url).set(bearer(vet.accessToken)).send({ isDraft: false })).status,
    ).toBe(200);
    expect(
      (await request(app).patch(url).set(bearer(vet.accessToken)).send({ notes: 'edit' })).status,
    ).toBe(200);
    await tick();
    expect(await ownerNotes(petOwner.id, 'MEDICAL_RECORD_ADDED')).toHaveLength(1);
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
    await request(app)
      .post(`${base}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'a' });
    await request(app)
      .post(`${base}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'b' });
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
    expect(before.body.data).toEqual({ medicalRecords: 2, vaccinations: 1, reminders: 1 });
    expect((await unseen(petOwner.accessToken, luna.id)).body.data).toEqual({
      medicalRecords: 0,
      vaccinations: 1,
      reminders: 0,
    });

    const cleared = await seen(petOwner.accessToken, milo.id, 'medicalRecords');
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toEqual({ updated: 2 });
    expect((await unseen(petOwner.accessToken, milo.id)).body.data).toEqual({
      medicalRecords: 0,
      vaccinations: 1,
      reminders: 1,
    });
    // Idempotent; other pets untouched.
    expect((await seen(petOwner.accessToken, milo.id, 'medicalRecords')).body.data).toEqual({
      updated: 0,
    });
    expect((await unseen(petOwner.accessToken, luna.id)).body.data.vaccinations).toBe(1);

    // Integrated with the normal read state: the global unread count drops too.
    const unread = await request(app)
      .get(`${API}/notifications/unread-count`)
      .set(bearer(petOwner.accessToken));
    expect(unread.body.data.count).toBe(3);

    // Someone else only ever sees their own (empty) counters for this pet.
    expect((await unseen(otherPetOwner.accessToken, milo.id)).body.data).toEqual({
      medicalRecords: 0,
      vaccinations: 0,
      reminders: 0,
    });
    expect((await seen(otherPetOwner.accessToken, milo.id, 'vaccinations')).body.data).toEqual({
      updated: 0,
    });
    expect((await unseen(petOwner.accessToken, milo.id)).body.data.vaccinations).toBe(1);
  });

  it('validates the section and the pet id', async () => {
    const { petOwner, milo } = await setup();
    expect((await seen(petOwner.accessToken, milo.id, 'everything')).status).toBe(422);
    expect((await unseen(petOwner.accessToken, 'not-a-uuid')).status).toBe(422);
    expect((await request(app).get(`${API}/notifications/pets/${milo.id}/unseen`)).status).toBe(
      401,
    );
  });
});
