import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * The full clinic ↔ pet scenario, end to end over HTTP:
 *
 *   Owner owns Pet A → Clinic A opens it by its short ID → adds a vaccination,
 *   a reminder and a private record → owner is notified for the owner-visible
 *   items only → owner sees vaccination + reminder (read-only), never the
 *   record → Clinic A edits / deletes its own → Clinic B sees none of it and
 *   does not list Pet A.
 */
const { app, container } = buildTestApp();
const API = '/api/v1';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function waitForNotifications(userId: string, min: number): Promise<Array<{ type: string }>> {
  for (let i = 0; i < 60; i += 1) {
    const rows = await container.db('notifications').where({ recipient_user_id: userId });
    if (rows.length >= min) return rows;
    await tick();
  }
  return container.db('notifications').where({ recipient_user_id: userId });
}

describe('clinic record isolation — end-to-end scenario', () => {
  it('owner visibility, owner read-only, creator-only writes, cross-clinic isolation, clinic pet lists', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app, { firstName: 'Sara' });
    const ownerA = await registerApprovedVet(app);
    const vetA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const clinicA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic A',
    });
    const clinicB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic B',
    });
    await addOrganizationMember(app, ownerA.accessToken, clinicA.id, {
      userId: vetA.id,
      role: 'VETERINARIAN',
    });
    const petA = await createAnimal(app, owner.accessToken, { name: 'Pet A' });

    // Short, human-facing ID — not the UUID.
    expect(petA.publicCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{7}$/);

    // --- Clinic A opens Pet A (a plain VETERINARIAN may) and adds data ---
    const opened = await openClinicPet(app, vetA.accessToken, clinicA.id, petA.publicCode);
    expect(opened).toMatchObject({ animalId: petA.id, workedWith: false });
    const a = `${API}/organizations/${clinicA.id}/animals/${petA.id}`;

    const vax = await request(app)
      .post(`${a}/vaccinations`)
      .set(bearer(vetA.accessToken))
      .send({ vaccineName: 'Rabies', administeredOn: '2026-10-01', nextDueOn: '2027-10-01' });
    expect(vax.status).toBe(201);
    const rem = await request(app)
      .post(`${a}/reminders`)
      .set(bearer(vetA.accessToken))
      .send({ title: 'Booster', reminderDate: '2099-01-01', reminderType: 'VACCINATION' });
    expect(rem.status).toBe(201);
    const rec = await request(app).post(`${a}/medical-records`).set(bearer(vetA.accessToken)).send({
      diagnosis: 'PRIVATE-DIAGNOSIS',
      treatment: 'PRIVATE-TREATMENT',
      notes: 'PRIVATE-NOTE',
    });
    expect(rec.status).toBe(201);

    // --- Owner is notified for the owner-visible items only ---
    const notes = await waitForNotifications(owner.id, 2);
    await tick();
    const types = (await container.db('notifications').where({ recipient_user_id: owner.id }))
      .map((n: { type: string }) => n.type)
      .sort();
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(types).toEqual(['REMINDER_ADDED', 'VACCINATION_ADDED']);

    // --- Owner sees vaccination + reminder, never the private record ---
    const ownerGet = (path: string) =>
      request(app).get(`${API}/animals/${petA.id}${path}`).set(bearer(owner.accessToken));
    const ownerVax = await ownerGet('/vaccinations');
    const ownerRem = await ownerGet('/reminders');
    expect(ownerVax.body.data.map((v: { id: string }) => v.id)).toEqual([vax.body.data.id]);
    expect(ownerRem.body.data.map((r: { id: string }) => r.id)).toEqual([rem.body.data.id]);
    expect((await ownerGet('/medical-records')).status).toBe(404);
    expect((await ownerGet(`/medical-records/${rec.body.data.id}`)).status).toBe(404);
    const ownerSurfaces = await Promise.all([
      ownerGet(''),
      ownerGet('/medical-history'),
      ownerGet('/clinics'),
      ownerVax,
      ownerRem,
      request(app).get(`${API}/notifications`).set(bearer(owner.accessToken)),
    ]);
    expect(JSON.stringify(ownerSurfaces.map((r) => r.body))).not.toMatch(/PRIVATE-/);
    expect(ownerSurfaces[0]!.body.data.publicCode).toBe(petA.publicCode);

    // --- Owner cannot edit / delete clinic-created data (any route) ---
    const ownerWrites = [
      request(app).patch(`${API}/animals/${petA.id}/vaccinations/${vax.body.data.id}`).send({}),
      request(app).delete(`${API}/animals/${petA.id}/vaccinations/${vax.body.data.id}`),
      request(app).delete(`${API}/animals/${petA.id}/reminders/${rem.body.data.id}`),
      request(app).patch(`${API}/animals/${petA.id}/reminders/${rem.body.data.id}`).send({}),
      request(app).patch(`${a}/vaccinations/${vax.body.data.id}`).send({ notes: 'owner edit' }),
      request(app).delete(`${a}/reminders/${rem.body.data.id}`),
      request(app).delete(`${a}/medical-records/${rec.body.data.id}`),
    ];
    for (const req of ownerWrites) {
      expect([403, 404]).toContain((await req.set(bearer(owner.accessToken))).status);
    }
    expect(await getTestDb()('vaccinations').where({ id: vax.body.data.id }).first()).toMatchObject(
      { notes: null },
    );
    expect(
      await getTestDb()('animal_reminders').where({ id: rem.body.data.id }).first(),
    ).toBeDefined();

    // --- Clinic B: cannot read / change any of Clinic A's data, does not list Pet A ---
    const b = `${API}/organizations/${clinicB.id}/animals/${petA.id}`;
    const asB = (req: request.Test) => req.set(bearer(ownerB.accessToken));
    for (const path of ['/medical-records', '/vaccinations', '/reminders', '/medical-history']) {
      const res = await asB(request(app).get(`${b}${path}`));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    }
    for (const req of [
      request(app).get(`${b}/medical-records/${rec.body.data.id}`),
      request(app).patch(`${b}/medical-records/${rec.body.data.id}`).send({ diagnosis: 'x' }),
      request(app).delete(`${b}/medical-records/${rec.body.data.id}`),
      request(app).get(`${b}/vaccinations/${vax.body.data.id}`),
      request(app).patch(`${b}/vaccinations/${vax.body.data.id}`).send({ notes: 'x' }),
      request(app).delete(`${b}/vaccinations/${vax.body.data.id}`),
      request(app).get(`${b}/reminders/${rem.body.data.id}`),
      request(app).patch(`${b}/reminders/${rem.body.data.id}`).send({ title: 'x' }),
      request(app).delete(`${b}/reminders/${rem.body.data.id}`),
      // Even pointing Clinic A's record id at Clinic B's URL for another path shape.
      request(app).post(`${b}/reminders/${rem.body.data.id}/notify`),
      request(app).post(`${b}/vaccinations/${vax.body.data.id}/notify`),
    ]) {
      expect((await asB(req)).status).toBe(404);
    }
    // Not a member of Clinic A at all.
    expect((await asB(request(app).get(`${a}/medical-records`))).status).toBe(403);
    const listB = await asB(request(app).get(`${API}/organizations/${clinicB.id}/clinic-pets`));
    expect(listB.body.data).toEqual([]);
    const summaryB = await asB(
      request(app).get(`${API}/organizations/${clinicB.id}/clinic-dashboard/summary`),
    );
    expect(summaryB.body.data.animals).toEqual({ activeCount: 0 });
    expect(summaryB.body.data.medical.medicalRecordsCount).toBe(0);
    for (const path of ['clinic-vaccinations', 'clinic-reminders']) {
      const res = await asB(request(app).get(`${API}/organizations/${clinicB.id}/${path}`));
      expect(res.body.data).toEqual([]);
    }
    const profileB = await asB(request(app).get(b));
    expect(profileB.body.data.relationship).toBeNull();
    expect(JSON.stringify(profileB.body)).not.toMatch(/PRIVATE-|Rabies|Booster/);

    // --- Clinic A: Recent / All Pets contain Pet A; edits + deletes its own rows ---
    const listA = await request(app)
      .get(`${API}/organizations/${clinicA.id}/clinic-pets`)
      .set(bearer(vetA.accessToken));
    expect(listA.body.data.map((p: { animalId: string }) => p.animalId)).toEqual([petA.id]);
    expect(listA.body.data[0].publicCode).toBe(petA.publicCode);
    const asA = (req: request.Test) => req.set(bearer(vetA.accessToken));
    expect(
      (await asA(request(app).patch(`${a}/vaccinations/${vax.body.data.id}`).send({ notes: 'ok' })))
        .status,
    ).toBe(200);
    expect(
      (
        await asA(
          request(app).patch(`${a}/medical-records/${rec.body.data.id}`).send({ notes: 'n' }),
        )
      ).status,
    ).toBe(200);
    expect((await asA(request(app).delete(`${a}/reminders/${rem.body.data.id}`))).status).toBe(200);
    expect(
      (await asA(request(app).delete(`${a}/medical-records/${rec.body.data.id}`))).status,
    ).toBe(200);

    // No link row was ever needed.
    expect(await getTestDb()('animal_clinic_access')).toHaveLength(0);
  });

  it('Recent Pets is per clinic and ordered by that clinic’s latest activity', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vetA = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const clinicA = await createActiveOrganization(app, vetA.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic One',
    });
    const clinicB = await createActiveOrganization(app, vetB.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic Two',
    });
    const p1 = await createAnimal(app, owner.accessToken, { name: 'P1' });
    const p2 = await createAnimal(app, owner.accessToken, { name: 'P2' });
    const rec = (token: string, orgId: string, animalId: string) =>
      request(app)
        .post(`${API}/organizations/${orgId}/animals/${animalId}/medical-records`)
        .set(bearer(token))
        .send({ diagnosis: 'x' })
        .expect(201);

    await rec(vetA.accessToken, clinicA.id, p1.id);
    await rec(vetA.accessToken, clinicA.id, p2.id);
    await rec(vetB.accessToken, clinicB.id, p2.id);
    await rec(vetA.accessToken, clinicA.id, p1.id); // P1 is now A's most recent

    const names = async (token: string, orgId: string) =>
      (
        await request(app).get(`${API}/organizations/${orgId}/clinic-pets`).set(bearer(token))
      ).body.data.map((p: { animal: { name: string } }) => p.animal.name);
    expect(await names(vetA.accessToken, clinicA.id)).toEqual(['P1', 'P2']);
    expect(await names(vetB.accessToken, clinicB.id)).toEqual(['P2']);
  });

  it('short public IDs are unique, case-insensitive and never sequential; existing UUIDs keep resolving', async () => {
    const owner = await registerUser(app);
    const animals = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createAnimal(app, owner.accessToken, { name: `P${i}` })),
    );
    const codes = animals.map((x) => x.publicCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{7}$/);
    // The DB rejects a duplicate outright.
    await expect(
      getTestDb()('animals').where({ id: animals[1]!.id }).update({ public_code: codes[0] }),
    ).rejects.toThrow();
    // A bulk insert path that bypasses the API still gets a code (trigger).
    const [row] = await getTestDb()('animals')
      .insert({
        name: 'raw',
        species: 'CAT',
        sex: 'UNKNOWN',
        status: 'ACTIVE',
        created_by: owner.id,
      })
      .returning('public_code');
    expect(row.public_code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{7}$/);

    // The owner finds their pet by its code (any case / dashed) via "My Pets" search.
    const target = animals[3]!;
    const dashed = `${target.publicCode.slice(0, 3)}-${target.publicCode.slice(3)}`.toLowerCase();
    const mine = await request(app)
      .get(`${API}/animals`)
      .query({ search: dashed })
      .set(bearer(owner.accessToken));
    expect(mine.body.data.map((x: { id: string }) => x.id)).toEqual([target.id]);
  });
});
