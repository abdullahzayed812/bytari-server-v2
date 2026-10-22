import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { businessToday } from '../../src/shared/time/business-date.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { buildRealtimeHarness, TestWs, type RealtimeHarness } from '../helpers/realtime.js';
import {
  addOrganizationMember,
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  createAnimal,
  openClinicPet,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

/**
 * End-to-end check of the clinic expiry rule from every role's point of view:
 * an EXPIRED clinic subscription stops only the OWNER; its veterinarian, its
 * STAFF employee (medical-record permissions by default) and a supervisor with
 * granted clinical permissions keep creating / updating records (persisted,
 * audited, owner notified incl. realtime); STAFF still cannot delete; outsiders
 * and STAFF of non-clinic organizations stay out; renewal restores the owner.
 */
let harness: RealtimeHarness;
const API = '/api/v1';

beforeAll(async () => {
  await ensureSchema();
  harness = await buildRealtimeHarness();
});
beforeEach(() => resetDb());
afterAll(async () => {
  await harness.close();
  await closeTestDb();
});

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function setPeriod(organizationId: string, start: string, end: string) {
  await getTestDb()('clinic_details')
    .where({ organization_id: organizationId })
    .update({ subscription_start_date: start, subscription_end_date: end });
}

const tick = () => new Promise((r) => setTimeout(r, 25));

async function waitForRows(table: string, where: Record<string, unknown>, n: number) {
  for (let i = 0; i < 80; i += 1) {
    const rows = await getTestDb()(table).where(where);
    if (rows.length >= n) return rows;
    await tick();
  }
  return getTestDb()(table).where(where);
}

const CLINICAL_GRANTS = [
  'organization.read',
  'animal.veterinary.access.read',
  'medical_record.read',
  'medical_record.create',
  'medical_record.update',
  'vaccination.read',
  'vaccination.create',
  'vaccination.update',
];

async function setup() {
  const app = harness.app;
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  // SUPERVISOR with clinical grants (supervisors must be approved veterinarians).
  const employee = await registerApprovedVet(app);
  const staff = await registerUser(app); // plain STAFF (medical-record perms by role, no delete)
  const outsider = await registerApprovedVet(app);
  const otherOwner = await registerApprovedVet(app);
  const petOwner = await registerUser(app);

  const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Expiry E2E Clinic',
  });
  const otherClinic = await createActiveOrganization(
    app,
    otherOwner.accessToken,
    admin.accessToken,
    { type: 'CLINIC', name: 'Other Clinic' },
  );
  await addOrganizationMember(app, owner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, owner.accessToken, clinic.id, {
    userId: staff.id,
    role: 'STAFF',
  });
  await assignOrganizationSupervisor(app, owner.accessToken, clinic.id, {
    userId: employee.id,
    permissions: CLINICAL_GRANTS,
  });

  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Luna' });
  await openClinicPet(app, owner.accessToken, clinic.id, animal.publicCode);
  const today = businessToday();
  await setPeriod(clinic.id, addDays(today, -30), addDays(today, 30));
  return {
    app,
    admin,
    owner,
    vet,
    employee,
    staff,
    outsider,
    otherOwner,
    petOwner,
    clinic,
    otherClinic,
    animal,
    today,
  };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/** Create one record, vaccination and reminder as `token`; returns the raw responses. */
async function createAll(ctx: Ctx, token: string, tag: string) {
  const a = `${API}/organizations/${ctx.clinic.id}/animals/${ctx.animal.id}`;
  const record = await request(ctx.app)
    .post(`${a}/medical-records`)
    .set(bearer(token))
    .send({ diagnosis: `dx-${tag}` });
  const vaccination = await request(ctx.app)
    .post(`${a}/vaccinations`)
    .set(bearer(token))
    .send({ vaccineName: `vax-${tag}`, administeredOn: ctx.today });
  const reminder = await request(ctx.app)
    .post(`${a}/reminders`)
    .set(bearer(token))
    .send({ title: `rem-${tag}`, reminderDate: addDays(ctx.today, 7), reminderType: 'CHECKUP' });
  return { record, vaccination, reminder };
}

describe('clinic expiry — role-based end-to-end', () => {
  it('active: the owner operates normally (baseline)', async () => {
    const ctx = await setup();
    const res = await createAll(ctx, ctx.owner.accessToken, 'owner-active');
    expect(res.record.status).toBe(201);
    expect(res.vaccination.status).toBe(201);
    expect(res.reminder.status).toBe(201);
    const summary = await request(ctx.app)
      .get(`${API}/organizations/${ctx.clinic.id}/clinic-dashboard/summary`)
      .set(bearer(ctx.owner.accessToken));
    expect(summary.status).toBe(200);
  });

  it('expired: owner locked (renewal open); vet, STAFF + permitted supervisor create/update/persist/notify; STAFF cannot delete; outsiders refused; renewal restores the owner', async () => {
    const ctx = await setup();
    const db = getTestDb();
    await setPeriod(ctx.clinic.id, addDays(ctx.today, -60), addDays(ctx.today, -1));
    const org = `${API}/organizations/${ctx.clinic.id}`;
    const a = `${org}/animals/${ctx.animal.id}`;

    // --- owner: operational writes refused with the expiry code ---------------
    const ownerWrites = await createAll(ctx, ctx.owner.accessToken, 'owner-expired');
    for (const [label, res] of Object.entries(ownerWrites)) {
      expect(res.status, `owner ${label}`).toBe(403);
      expect(res.body.error.code, `owner ${label}`).toBe('ORGANIZATION_SUBSCRIPTION_EXPIRED');
    }
    const ownerSummary = await request(ctx.app)
      .get(`${org}/clinic-dashboard/summary`)
      .set(bearer(ctx.owner.accessToken));
    expect(ownerSummary.status).toBe(403);
    // … but status + renewal stay reachable.
    const ownerDetail = await request(ctx.app).get(org).set(bearer(ctx.owner.accessToken));
    expect(ownerDetail.status).toBe(200);
    expect(ownerDetail.body.data.details.subscriptionStatus).toBe('EXPIRED');
    expect(ownerDetail.body.data.myRole).toBe('OWNER');
    const renewal = await request(ctx.app)
      .post(`${org}/subscription-renewals`)
      .set(bearer(ctx.owner.accessToken))
      .send({ note: 'تجديد' });
    expect([200, 201]).toContain(renewal.status);

    // The pet owner listens for realtime notifications on their own user room.
    const ws = await TestWs.connect(harness.wsUrl(ctx.petOwner.accessToken));
    await ws.next('welcome');

    // --- vet + permitted employee: dashboard, search, create, update ---------
    for (const [who, user] of [
      ['vet', ctx.vet],
      ['employee', ctx.employee],
      ['staff', ctx.staff],
    ] as const) {
      const token = user.accessToken;
      const detail = await request(ctx.app).get(org).set(bearer(token));
      expect(detail.status, `${who} org detail`).toBe(200);
      expect(detail.body.data.myRole, `${who} myRole`).not.toBe('OWNER');
      const summary = await request(ctx.app)
        .get(`${org}/clinic-dashboard/summary`)
        .set(bearer(token));
      expect(summary.status, `${who} dashboard`).toBe(200);
      const lookup = await request(ctx.app)
        .get(`${org}/clinic-pets/lookup`)
        .query({ code: ctx.animal.publicCode })
        .set(bearer(token));
      expect(lookup.status, `${who} pet search`).toBe(200);
      expect(lookup.body.data.animalId).toBe(ctx.animal.id);

      const created = await createAll(ctx, token, who);
      expect(created.record.status, `${who} record`).toBe(201);
      expect(created.vaccination.status, `${who} vaccination`).toBe(201);
      expect(created.reminder.status, `${who} reminder`).toBe(201);
      const recordId = created.record.body.data.id as string;
      const vaxId = created.vaccination.body.data.id as string;
      const remId = created.reminder.body.data.id as string;

      // Persisted in the database, attributed to the clinic + actor.
      const recRow = await db('medical_records').where({ id: recordId }).first();
      expect(recRow).toMatchObject({
        organization_id: ctx.clinic.id,
        animal_id: ctx.animal.id,
        diagnosis: `dx-${who}`,
      });
      expect(await db('vaccinations').where({ id: vaxId }).first()).toMatchObject({
        organization_id: ctx.clinic.id,
        vaccine_name: `vax-${who}`,
      });
      expect(await db('animal_reminders').where({ id: remId }).first()).toMatchObject({
        organization_id: ctx.clinic.id,
        title: `rem-${who}`,
      });

      // Retrievable afterwards through the API.
      const recGet = await request(ctx.app)
        .get(`${a}/medical-records/${recordId}`)
        .set(bearer(token));
      expect(recGet.status, `${who} record get`).toBe(200);
      const vaxGet = await request(ctx.app).get(`${a}/vaccinations/${vaxId}`).set(bearer(token));
      expect(vaxGet.status, `${who} vaccination get`).toBe(200);
      const remList = await request(ctx.app).get(`${a}/reminders`).set(bearer(token));
      expect(remList.status, `${who} reminders list`).toBe(200);
      expect(JSON.stringify(remList.body.data)).toContain(remId);

      // Updates work and persist.
      const recPatch = await request(ctx.app)
        .patch(`${a}/medical-records/${recordId}`)
        .set(bearer(token))
        .send({ diagnosis: `dx-${who}-updated` });
      expect(recPatch.status, `${who} record patch`).toBe(200);
      expect((await db('medical_records').where({ id: recordId }).first()).diagnosis).toBe(
        `dx-${who}-updated`,
      );
      const vaxPatch = await request(ctx.app)
        .patch(`${a}/vaccinations/${vaxId}`)
        .set(bearer(token))
        .send({ notes: `note-${who}` });
      expect(vaxPatch.status, `${who} vaccination patch`).toBe(200);
      const remPatch = await request(ctx.app)
        .patch(`${a}/reminders/${remId}`)
        .set(bearer(token))
        .send({ isCompleted: true });
      expect(remPatch.status, `${who} reminder patch`).toBe(200);
      expect((await db('animal_reminders').where({ id: remId }).first()).is_completed).toBe(true);

      // Audit trail still written for the staff actor.
      const audits = await db('audit_logs')
        .where({ actor_user_id: user.id })
        .whereIn('action', [
          'MEDICAL_RECORD_CREATED',
          'MEDICAL_RECORD_UPDATED',
          'VACCINATION_CREATED',
          'VACCINATION_UPDATED',
          'ANIMAL_REMINDER_CREATED',
          'ANIMAL_REMINDER_UPDATED',
        ]);
      expect(new Set(audits.map((r) => r.action)).size, `${who} audit actions`).toBe(6);

      // Manual "notify the owner" (requires *.update) works too.
      const vaxNotify = await request(ctx.app)
        .post(`${a}/vaccinations/${vaxId}/notify`)
        .set(bearer(token));
      expect(vaxNotify.status, `${who} vaccination notify`).toBe(200);
    }

    // Owner-visible additions reached the pet owner: DB rows + realtime events.
    const added = await waitForRows(
      'notifications',
      { recipient_user_id: ctx.petOwner.id, type: 'VACCINATION_ADDED' },
      3,
    );
    expect(added).toHaveLength(3);
    expect(
      await waitForRows(
        'notifications',
        { recipient_user_id: ctx.petOwner.id, type: 'REMINDER_ADDED' },
        3,
      ),
    ).toHaveLength(3);
    expect(
      (
        await waitForRows(
          'notifications',
          { recipient_user_id: ctx.petOwner.id, type: 'VACCINATION_DUE' },
          3,
        )
      ).length,
    ).toBeGreaterThanOrEqual(3);
    const evt = await ws.next('notification.created', 3000);
    expect(evt.data).toHaveProperty('notificationId');
    ws.close();

    // --- plain STAFF employee: appointments desk too; deleting stays refused --
    const staffAppointments = await request(ctx.app)
      .get(`${org}/clinic-appointments`)
      .set(bearer(ctx.staff.accessToken));
    expect(staffAppointments.status).toBe(200);
    const staffRecord = await db('medical_records')
      .where({ organization_id: ctx.clinic.id, recorded_by_user_id: ctx.staff.id })
      .first('id');
    const staffVax = await db('vaccinations')
      .where({ organization_id: ctx.clinic.id, vaccine_name: 'vax-staff' })
      .first('id');
    for (const [label, url] of [
      ['record delete', `${a}/medical-records/${staffRecord.id}`],
      ['vaccination delete', `${a}/vaccinations/${staffVax.id}`],
    ] as const) {
      const res = await request(ctx.app).delete(url).set(bearer(ctx.staff.accessToken));
      expect(res.status, `staff ${label}`).toBe(403);
      // Refused by role permissions — NOT by the subscription.
      expect(res.body.error.code, `staff ${label}`).toBe('PERMISSION_DENIED');
    }
    expect(await db('medical_records').where({ id: staffRecord.id })).toHaveLength(1);

    // --- outsiders: another clinic's owner / a vet of no clinic / pet owner --
    const anyRecord = await db('medical_records')
      .where({ organization_id: ctx.clinic.id })
      .first('id');
    for (const [who, user] of [
      ['outsider vet', ctx.outsider],
      ['other clinic owner', ctx.otherOwner],
      ['pet owner', ctx.petOwner],
    ] as const) {
      const token = user.accessToken;
      const summary = await request(ctx.app)
        .get(`${org}/clinic-dashboard/summary`)
        .set(bearer(token));
      expect(summary.status, `${who} dashboard`).toBe(403);
      const writes = await createAll(ctx, token, `outsider-${who}`);
      for (const [label, res] of Object.entries(writes)) {
        expect(res.status, `${who} ${label}`).toBe(403);
      }
      const read = await request(ctx.app)
        .get(`${a}/medical-records/${anyRecord.id}`)
        .set(bearer(token));
      expect(read.status, `${who} read record`).toBe(403);
      const patch = await request(ctx.app)
        .patch(`${a}/medical-records/${anyRecord.id}`)
        .set(bearer(token))
        .send({ diagnosis: 'tampered' });
      expect(patch.status, `${who} patch record`).toBe(403);
    }
    // Using their OWN clinic's id grants nothing on this clinic's record.
    const crossClinic = await request(ctx.app)
      .patch(
        `${API}/organizations/${ctx.otherClinic.id}/animals/${ctx.animal.id}/medical-records/${anyRecord.id}`,
      )
      .set(bearer(ctx.otherOwner.accessToken))
      .send({ diagnosis: 'tampered' });
    expect([403, 404]).toContain(crossClinic.status);
    expect(
      await db('medical_records').where({ organization_id: ctx.clinic.id, diagnosis: 'tampered' }),
    ).toHaveLength(0);

    // --- renewal (admin sets new dates) restores the owner -------------------
    await setPeriod(ctx.clinic.id, ctx.today, addDays(ctx.today, 365));
    const ownerAgain = await createAll(ctx, ctx.owner.accessToken, 'owner-renewed');
    expect(ownerAgain.record.status).toBe(201);
    expect(ownerAgain.vaccination.status).toBe(201);
    expect(ownerAgain.reminder.status).toBe(201);
    const vetAgain = await request(ctx.app)
      .get(`${org}/clinic-dashboard/summary`)
      .set(bearer(ctx.vet.accessToken));
    expect(vetAgain.status).toBe(200);
  });

  it('STAFF of a non-clinic organization gains nothing on the clinical routes', async () => {
    const ctx = await setup();
    const office = await createActiveOrganization(
      ctx.app,
      ctx.otherOwner.accessToken,
      ctx.admin.accessToken,
      { type: 'VETERINARY_OFFICE', name: 'Office' },
    );
    const officeStaff = await registerUser(ctx.app);
    await addOrganizationMember(ctx.app, ctx.otherOwner.accessToken, office.id, {
      userId: officeStaff.id,
      role: 'STAFF',
    });
    const a = `${API}/organizations/${office.id}/animals/${ctx.animal.id}`;
    const token = officeStaff.accessToken;
    for (const res of [
      await request(ctx.app)
        .post(`${a}/medical-records`)
        .set(bearer(token))
        .send({ diagnosis: 'x' }),
      await request(ctx.app)
        .post(`${a}/vaccinations`)
        .set(bearer(token))
        .send({ vaccineName: 'Rabies', administeredOn: ctx.today }),
      await request(ctx.app)
        .post(`${a}/reminders`)
        .set(bearer(token))
        .send({ title: 'x', reminderDate: ctx.today }),
      await request(ctx.app).get(`${a}/medical-records`).set(bearer(token)),
      await request(ctx.app).get(`${a}/medical-history`).set(bearer(token)),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
    }
    expect(await getTestDb()('medical_records').where({ organization_id: office.id })).toHaveLength(
      0,
    );
  });
});
