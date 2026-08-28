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
  const petOwner = await registerUser(app);
  const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'History Clinic',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Milo' });
  await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, animal.id);
  return { admin, clinicOwner, vet, petOwner, clinic, animal };
}

const clinicHistory = (clinicId: string, animalId: string): string =>
  `/api/v1/organizations/${clinicId}/animals/${animalId}/medical-history`;
const ownerHistory = (animalId: string): string => `/api/v1/animals/${animalId}/medical-history`;

/** Seed 2 records + 2 vaccinations on distinct dates so ordering is deterministic. */
async function seedEntries(token: string, clinicId: string, animalId: string) {
  await createMedicalRecord(app, token, clinicId, animalId, {
    visitDate: '2026-01-10',
    diagnosis: 'Checkup',
  });
  await createVaccination(app, token, clinicId, animalId, {
    vaccineName: 'Rabies',
    administeredOn: '2026-02-15',
  });
  await createMedicalRecord(app, token, clinicId, animalId, {
    visitDate: '2026-03-01',
    diagnosis: 'Follow visit',
  });
  await createVaccination(app, token, clinicId, animalId, {
    vaccineName: 'DHPP',
    administeredOn: '2026-04-20',
  });
}

describe('medical history timeline — clinic-facing', () => {
  it('composes medical records + vaccinations, newest first', async () => {
    const { vet, clinic, animal } = await setup();
    await seedEntries(vet.accessToken, clinic.id, animal.id);

    const res = await request(app)
      .get(clinicHistory(clinic.id, animal.id))
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(4);
    const seq = (res.body.data as Array<{ type: string; occurredOn: string }>).map(
      (e) => `${e.type}:${e.occurredOn}`,
    );
    expect(seq).toEqual([
      'VACCINATION:2026-04-20',
      'MEDICAL_RECORD:2026-03-01',
      'VACCINATION:2026-02-15',
      'MEDICAL_RECORD:2026-01-10',
    ]);
    // each entry carries exactly one of the sub-objects
    for (const e of res.body.data as Array<Record<string, unknown>>) {
      if (e.type === 'MEDICAL_RECORD') {
        expect(e.medicalRecord).toBeTruthy();
        expect(e.vaccination).toBeUndefined();
      } else {
        expect(e.vaccination).toBeTruthy();
        expect(e.medicalRecord).toBeUndefined();
      }
    }
  });

  it('supports ?type= to restrict the timeline', async () => {
    const { vet, clinic, animal } = await setup();
    await seedEntries(vet.accessToken, clinic.id, animal.id);

    const recs = await request(app)
      .get(`${clinicHistory(clinic.id, animal.id)}?type=MEDICAL_RECORD`)
      .set(bearer(vet.accessToken));
    expect(recs.body.data).toHaveLength(2);
    expect(
      (recs.body.data as Array<{ type: string }>).every((e) => e.type === 'MEDICAL_RECORD'),
    ).toBe(true);
    expect(recs.body.meta.total).toBe(2);

    const vax = await request(app)
      .get(`${clinicHistory(clinic.id, animal.id)}?type=VACCINATION`)
      .set(bearer(vet.accessToken));
    expect(vax.body.data).toHaveLength(2);
    expect(vax.body.meta.total).toBe(2);
  });

  it('paginates the merged timeline', async () => {
    const { vet, clinic, animal } = await setup();
    await seedEntries(vet.accessToken, clinic.id, animal.id);

    const page1 = await request(app)
      .get(`${clinicHistory(clinic.id, animal.id)}?page=1&pageSize=3`)
      .set(bearer(vet.accessToken));
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.meta.total).toBe(4);

    const page2 = await request(app)
      .get(`${clinicHistory(clinic.id, animal.id)}?page=2&pageSize=3`)
      .set(bearer(vet.accessToken));
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0]).toMatchObject({ type: 'MEDICAL_RECORD', occurredOn: '2026-01-10' });
  });

  it('returns an empty timeline for an animal with no medical data', async () => {
    const { vet, clinic, animal } = await setup();
    const res = await request(app)
      .get(clinicHistory(clinic.id, animal.id))
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  it('denies a clinic with no veterinary-access grant (404)', async () => {
    const { clinicOwner, vet, clinic, animal } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    // revoke the grant (owner holds `animal.veterinary.access.manage`)
    await request(app)
      .delete(`/api/v1/organizations/${clinic.id}/animal-access/${animal.id}`)
      .set(bearer(clinicOwner.accessToken))
      .expect(200);

    const res = await request(app)
      .get(clinicHistory(clinic.id, animal.id))
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(404);
  });

  it('cross-clinic: a second clinic with no grant cannot read the timeline (404)', async () => {
    const { admin, vet, clinic, animal } = await setup();
    await seedEntries(vet.accessToken, clinic.id, animal.id);

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
      .get(clinicHistory(clinicB.id, animal.id))
      .set(bearer(vetB.accessToken));
    expect(res.status).toBe(404);
  });

  it('a clinic WITH a grant sees the full cross-clinic history', async () => {
    const { admin, vet, clinic, animal } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      visitDate: '2026-01-05',
      diagnosis: 'A-diag',
    });

    const ownerB = await registerApprovedVet(app);
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic B',
    });
    await grantVeterinaryAccess(app, ownerB.accessToken, clinicB.id, animal.id);
    await createVaccination(app, ownerB.accessToken, clinicB.id, animal.id, {
      vaccineName: 'Lepto',
      administeredOn: '2026-02-01',
    });

    const res = await request(app)
      .get(clinicHistory(clinicB.id, animal.id))
      .set(bearer(ownerB.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    const kinds = (res.body.data as Array<{ type: string }>).map((e) => e.type);
    expect(kinds).toEqual(['VACCINATION', 'MEDICAL_RECORD']);
  });

  it('lets an ADMIN read any animal’s timeline without a grant', async () => {
    const { admin, vet, clinic, animal } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    const res = await request(app)
      .get(clinicHistory(clinic.id, animal.id))
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('medical history timeline — owner-facing', () => {
  it('the current owner reads the composed timeline; a stranger gets 404', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    await seedEntries(vet.accessToken, clinic.id, animal.id);

    const ownerView = await request(app)
      .get(ownerHistory(animal.id))
      .set(bearer(petOwner.accessToken));
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.meta.total).toBe(4);
    expect(ownerView.body.data[0]).toMatchObject({ type: 'VACCINATION', occurredOn: '2026-04-20' });

    const stranger = await registerUser(app);
    const strangerView = await request(app)
      .get(ownerHistory(animal.id))
      .set(bearer(stranger.accessToken));
    expect(strangerView.status).toBe(404);

    // there is no owner-facing write route for the timeline
    const write = await request(app)
      .post(ownerHistory(animal.id))
      .set(bearer(petOwner.accessToken));
    expect(write.status).toBe(404);
  });

  it('ownership transfer preserves the timeline; the new owner inherits it', async () => {
    const { petOwner, vet, clinic, animal } = await setup();
    await seedEntries(vet.accessToken, clinic.id, animal.id);
    const newOwner = await registerUser(app);

    await transferAnimal(app, petOwner.accessToken, animal.id, newOwner.id);

    const oldOwner = await request(app)
      .get(ownerHistory(animal.id))
      .set(bearer(petOwner.accessToken));
    expect(oldOwner.status).toBe(404);

    const newOwnerView = await request(app)
      .get(ownerHistory(animal.id))
      .set(bearer(newOwner.accessToken));
    expect(newOwnerView.status).toBe(200);
    expect(newOwnerView.body.meta.total).toBe(4);
  });
});
