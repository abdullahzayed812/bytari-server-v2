import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { businessToday } from '../../src/shared/time/business-date.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
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
  const vet = await registerApprovedVet(app);
  const petOwner = await registerUser(app);
  const clinic = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Ordering Clinic',
  });
  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Luna' });
  await openClinicPet(app, vet.accessToken, clinic.id, animal.publicCode);
  return { vet, petOwner, clinic, animal };
}

const base = (orgId: string, animalId: string) =>
  `${API}/organizations/${orgId}/animals/${animalId}`;

/** Pin `created_at` so ordering never depends on how fast the inserts ran. */
async function setCreatedAt(table: string, id: string, iso: string): Promise<void> {
  await getTestDb()(table).where({ id }).update({ created_at: iso });
}

describe('clinic dashboard cards — newest first by creation time', () => {
  it('medical records (incl. lab / files / notes views) list newest-created first, regardless of visit date', async () => {
    const { vet, clinic, animal } = await setup();
    // Created first, but with the LATEST visit date — must still come last.
    const oldest = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      visitDate: '2026-03-10',
      notes: 'first',
    });
    const middle = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      visitDate: '2026-01-01',
      notes: 'second',
    });
    const newest = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id, {
      visitDate: '2025-12-01',
      notes: 'third',
    });
    await setCreatedAt('medical_records', oldest.id, '2026-04-01T08:00:00Z');
    await setCreatedAt('medical_records', middle.id, '2026-04-02T08:00:00Z');
    await setCreatedAt('medical_records', newest.id, '2026-04-03T08:00:00Z');

    const res = await request(app)
      .get(`${base(clinic.id, animal.id)}/medical-records`)
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([
      newest.id,
      middle.id,
      oldest.id,
    ]);

    // Pagination keeps the same order with no overlap.
    const p1 = await request(app)
      .get(`${base(clinic.id, animal.id)}/medical-records?page=1&pageSize=2`)
      .set(bearer(vet.accessToken));
    const p2 = await request(app)
      .get(`${base(clinic.id, animal.id)}/medical-records?page=2&pageSize=2`)
      .set(bearer(vet.accessToken));
    expect([...p1.body.data, ...p2.body.data].map((r: { id: string }) => r.id)).toEqual([
      newest.id,
      middle.id,
      oldest.id,
    ]);
  });

  it('records with the same creation time are ordered deterministically across pages', async () => {
    const { vet, clinic, animal } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
      await setCreatedAt('medical_records', r.id, '2026-04-01T08:00:00Z');
      ids.push(r.id);
    }
    const pages: string[] = [];
    for (const page of [1, 2]) {
      const res = await request(app)
        .get(`${base(clinic.id, animal.id)}/medical-records?page=${page}&pageSize=2`)
        .set(bearer(vet.accessToken));
      pages.push(...res.body.data.map((r: { id: string }) => r.id));
    }
    expect(new Set(pages).size).toBe(4);
    expect([...pages].sort()).toEqual([...ids].sort());
  });

  it('vaccinations list newest-created first for the clinic (per pet and clinic-wide)', async () => {
    const { vet, clinic, animal } = await setup();
    const a = await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      vaccineName: 'A',
      administeredOn: '2026-03-01',
      nextDueOn: '2026-05-01',
    });
    const b = await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      vaccineName: 'B',
      administeredOn: '2026-01-01',
      nextDueOn: '2027-01-01',
    });
    await setCreatedAt('vaccinations', a.id, '2026-04-01T08:00:00Z');
    await setCreatedAt('vaccinations', b.id, '2026-04-02T08:00:00Z');

    const perPet = await request(app)
      .get(`${base(clinic.id, animal.id)}/vaccinations`)
      .set(bearer(vet.accessToken));
    expect(perPet.status).toBe(200);
    expect(perPet.body.data.map((v: { id: string }) => v.id)).toEqual([b.id, a.id]);

    const clinicWide = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-vaccinations`)
      .set(bearer(vet.accessToken));
    expect(clinicWide.status).toBe(200);
    expect(
      clinicWide.body.data.map((row: { vaccination: { id: string } }) => row.vaccination.id),
    ).toEqual([b.id, a.id]);
  });

  it('reminders list newest-created first for the clinic (per pet and clinic-wide)', async () => {
    const { vet, clinic, animal } = await setup();
    const today = businessToday();
    const create = async (title: string): Promise<string> => {
      const res = await request(app)
        .post(`${base(clinic.id, animal.id)}/reminders`)
        .set(bearer(vet.accessToken))
        .send({ title, reminderDate: today, reminderType: 'CHECKUP' });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    const first = await create('first');
    const second = await create('second');
    await setCreatedAt('animal_reminders', first, '2026-04-01T08:00:00Z');
    await setCreatedAt('animal_reminders', second, '2026-04-02T08:00:00Z');

    const perPet = await request(app)
      .get(`${base(clinic.id, animal.id)}/reminders`)
      .set(bearer(vet.accessToken));
    expect(perPet.status).toBe(200);
    expect(perPet.body.data.map((r: { id: string }) => r.id)).toEqual([second, first]);

    const clinicWide = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-reminders`)
      .set(bearer(vet.accessToken));
    expect(clinicWide.status).toBe(200);
    expect(
      clinicWide.body.data.map((row: { reminder: { id: string } }) => row.reminder.id),
    ).toEqual([second, first]);
  });

  it('the pet owner’s own reminder view keeps its soonest-due order (unchanged)', async () => {
    const { vet, petOwner, clinic, animal } = await setup();
    const make = async (title: string, reminderDate: string): Promise<string> => {
      const res = await request(app)
        .post(`${base(clinic.id, animal.id)}/reminders`)
        .set(bearer(vet.accessToken))
        .send({ title, reminderDate, reminderType: 'CHECKUP' });
      return res.body.data.id as string;
    };
    const later = await make('later', '2027-06-01');
    const sooner = await make('sooner', '2027-01-01');

    const res = await request(app)
      .get(`${API}/animals/${animal.id}/reminders`)
      .set(bearer(petOwner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([sooner, later]);
  });
});
