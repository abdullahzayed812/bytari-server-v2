import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { businessToday } from '../../src/shared/time/business-date.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { FakePushProvider } from '../helpers/fake-push-provider.js';
import {
  addOrganizationMember,
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  createAnimal,
  createFarm,
  createVaccination,
  openClinicPet,
  registerAdmin,
  registerApprovedVet,
  registerDevice,
  registerUser,
} from '../helpers/factories.js';

const push = new FakePushProvider();
const { app, container } = buildTestApp({ pushProvider: push });
const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  push.sent.length = 0;
});
afterAll(() => closeTestDb());

/** Notification rows are written by async handlers — poll until `min` exist (or time out). */
async function rowsFor(userId: string, type: string, min = 1, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows: Array<{ type: string; source_event_key: string | null; data: unknown }> =
      await getTestDb()('notifications').where({ recipient_user_id: userId, type });
    if (rows.length >= min || Date.now() > deadline) return rows;
    await tick();
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('farm appointment → notifications', () => {
  it('reaches the owner and every member who can read appointments (in-app + push), never the creator or an ungranted supervisor', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const vet = await registerApprovedVet(app);
    const employee = await registerUser(app);
    // An organization supervisor must be an approved veterinarian.
    const grantedSupervisor = await registerApprovedVet(app);
    const plainSupervisor = await registerApprovedVet(app);
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: employee.id,
      role: 'STAFF',
    });
    await assignOrganizationSupervisor(app, owner.accessToken, farm.id, {
      userId: grantedSupervisor.id,
      permissions: ['farm.appointment.read'],
    });
    await assignOrganizationSupervisor(app, owner.accessToken, farm.id, {
      userId: plainSupervisor.id,
      permissions: ['farm.expense.read'],
    });
    await registerDevice(app, owner.accessToken, {
      token: 'owner-token-aaaaaaaaaaaa',
      platform: 'android',
    });

    const appt = await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/appointments`)
      .set(bearer(vet.accessToken))
      .send({ title: 'تحصين نيوكاسل', category: 'VACCINATION', scheduledFor: businessToday() });
    expect(appt.status).toBe(201);
    const key = `farm.appointment.created:${appt.body.data.id}`;

    for (const u of [owner, employee, grantedSupervisor]) {
      const rows = await rowsFor(u.id, 'FARM_APPOINTMENT_CREATED');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source_event_key).toBe(key);
    }
    await tick(300);
    expect(await rowsFor(vet.id, 'FARM_APPOINTMENT_CREATED', 1, 0)).toHaveLength(0);
    expect(await rowsFor(plainSupervisor.id, 'FARM_APPOINTMENT_CREATED', 1, 0)).toHaveLength(0);

    // Push went to the owner's registered device, with ids-only data.
    const toOwner = push.sent.filter((s) => s.tokens.includes('owner-token-aaaaaaaaaaaa'));
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]?.data).toMatchObject({
      type: 'FARM_APPOINTMENT_CREATED',
      organizationId: farm.id,
      appointmentId: appt.body.data.id,
    });

    // Every recipient can open what they were told about.
    const opened = await request(app)
      .get(`/api/v1/organizations/${farm.id}/farm/appointments/${appt.body.data.id}`)
      .set(bearer(grantedSupervisor.accessToken));
    expect(opened.status).toBe(200);
  });

  it('a farm OWNER creating it notifies the vet; push is skipped when the user disabled it (in-app kept)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const vet = await registerApprovedVet(app);
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    await registerDevice(app, vet.accessToken, {
      token: 'vet-token-bbbbbbbbbbbbbb',
      platform: 'android',
    });
    await request(app)
      .patch('/api/v1/notifications/preferences')
      .set(bearer(vet.accessToken))
      .send({ pushEnabled: false })
      .expect(200);

    await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/appointments`)
      .set(bearer(owner.accessToken))
      .send({ title: 'زيارة بيطرية', category: 'VET_VISIT', scheduledFor: businessToday() })
      .expect(201);

    expect(await rowsFor(vet.id, 'FARM_APPOINTMENT_CREATED')).toHaveLength(1);
    expect(await rowsFor(owner.id, 'FARM_APPOINTMENT_CREATED', 1, 300)).toHaveLength(0);
    await tick(200);
    expect(push.sent.filter((s) => s.tokens.includes('vet-token-bbbbbbbbbbbbbb'))).toHaveLength(0);
  });

  it('a failed appointment write (validation) notifies nobody — events only follow committed rows', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const vet = await registerApprovedVet(app);
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    const bad = await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/appointments`)
      .set(bearer(owner.accessToken))
      .send({ title: '', scheduledFor: 'not-a-date' });
    expect(bad.status).toBe(422);
    expect(await rowsFor(vet.id, 'FARM_APPOINTMENT_CREATED', 1, 400)).toHaveLength(0);
  });
});

describe('farm appointment — assigned veterinarian + scheduled-day reminder', () => {
  async function setup() {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const vet = await registerApprovedVet(app);
    const vet2 = await registerApprovedVet(app);
    const employee = await registerUser(app);
    const outsider = await registerApprovedVet(app);
    for (const [u, role] of [
      [vet, 'VETERINARIAN'],
      [vet2, 'VETERINARIAN'],
      [employee, 'STAFF'],
    ] as const) {
      await addOrganizationMember(app, owner.accessToken, farm.id, { userId: u.id, role });
    }
    await registerDevice(app, vet.accessToken, {
      token: 'vet-due-token-dddddddddd',
      platform: 'android',
    });
    return { admin, owner, farm, vet, vet2, employee, outsider };
  }
  const create = (token: string, farmId: string, body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v1/organizations/${farmId}/farm/appointments`)
      .set(bearer(token))
      .send({ title: 'تحصين', category: 'VACCINATION', ...body });
  const sweep = (now: Date) => container.farmAppointmentDueNotifier.runOnce(now);
  const dueRows = (userId: string) =>
    getTestDb()('notifications').where({ recipient_user_id: userId, type: 'FARM_APPOINTMENT_DUE' });

  it('assigns an active farm veterinarian: they get FARM_APPOINTMENT_ASSIGNED, others CREATED; outsiders / staff are refused', async () => {
    const { owner, farm, vet, vet2, employee, outsider } = await setup();

    for (const bad of [outsider.id, employee.id]) {
      const res = await create(owner.accessToken, farm.id, {
        scheduledFor: '2027-03-10',
        assignedVeterinarianUserId: bad,
      });
      expect(res.status).toBe(422);
    }

    const res = await create(owner.accessToken, farm.id, {
      scheduledFor: '2027-03-10',
      assignedVeterinarianUserId: vet.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.assignedVeterinarianUserId).toBe(vet.id);
    expect(res.body.data.assignedVeterinarian).toMatchObject({ id: vet.id });
    const id = res.body.data.id as string;

    expect(await rowsFor(vet.id, 'FARM_APPOINTMENT_ASSIGNED')).toHaveLength(1);
    expect(await rowsFor(employee.id, 'FARM_APPOINTMENT_CREATED')).toHaveLength(1);
    expect(await rowsFor(vet2.id, 'FARM_APPOINTMENT_CREATED')).toHaveLength(1);
    await tick(200);
    expect(await rowsFor(vet.id, 'FARM_APPOINTMENT_CREATED', 1, 0)).toHaveLength(0);

    // Re-assigning on edit tells the new veterinarian.
    const patched = await request(app)
      .patch(`/api/v1/organizations/${farm.id}/farm/appointments/${id}`)
      .set(bearer(owner.accessToken))
      .send({ assignedVeterinarianUserId: vet2.id });
    expect(patched.status).toBe(200);
    expect(patched.body.data.assignedVeterinarian).toMatchObject({ id: vet2.id });
    expect(await rowsFor(vet2.id, 'FARM_APPOINTMENT_ASSIGNED')).toHaveLength(1);

    const list = await request(app)
      .get(`/api/v1/organizations/${farm.id}/farm/appointments`)
      .set(bearer(employee.accessToken));
    expect(list.body.data[0].assignedVeterinarian).toMatchObject({ id: vet2.id });
  });

  it('on the scheduled day (Iraq time, from 08:00) reminds owner, assigned vet, employees and the creator — exactly once', async () => {
    const { owner, farm, vet, vet2, employee } = await setup();
    const res = await create(employee.accessToken, farm.id, {
      scheduledFor: '2027-03-10',
      assignedVeterinarianUserId: vet.id,
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    // Not this farm's day / not yet: other dates, and before 08:00 local.
    await create(owner.accessToken, farm.id, { scheduledFor: '2027-03-11' });
    const done = await create(owner.accessToken, farm.id, { scheduledFor: '2027-03-10' });
    await request(app)
      .patch(`/api/v1/organizations/${farm.id}/farm/appointments/${done.body.data.id}`)
      .set(bearer(owner.accessToken))
      .send({ status: 'DONE' })
      .expect(200);

    // 23:00 on 9 March in Baghdad (20:00Z) — UTC and local are the same day, not the day.
    expect((await sweep(new Date('2027-03-09T20:00:00Z'))).due).toBe(0);
    // 00:30 on 10 March in Baghdad (21:30Z on the 9th) — the day, but before 08:00.
    expect((await sweep(new Date('2027-03-09T21:30:00Z'))).due).toBe(0);
    expect(await dueRows(owner.id)).toHaveLength(0);

    // 08:30 local — exactly the one UPCOMING appointment of the day.
    const first = await sweep(new Date('2027-03-10T05:30:00Z'));
    expect(first.due).toBe(1);
    for (const u of [owner, vet, vet2, employee]) {
      const rows = await dueRows(u.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].source_event_key).toBe(`farm.appointment.due:${id}:2027-03-10`);
      expect(rows[0].body).toContain('تحصين');
    }
    await tick(200);
    const pushesToVet = () =>
      push.sent.filter(
        (s) =>
          s.tokens.includes('vet-due-token-dddddddddd') && s.data?.type === 'FARM_APPOINTMENT_DUE',
      ).length;
    expect(pushesToVet()).toBe(1);

    // Every later sweep that day is a no-op: no new rows, no second push.
    await sweep(new Date('2027-03-10T12:00:00Z'));
    await tick(200);
    for (const u of [owner, vet, vet2, employee]) expect(await dueRows(u.id)).toHaveLength(1);
    expect(pushesToVet()).toBe(1);

    // Rescheduling re-arms the reminder for the new day.
    await request(app)
      .patch(`/api/v1/organizations/${farm.id}/farm/appointments/${id}`)
      .set(bearer(owner.accessToken))
      .send({ scheduledFor: '2027-03-12' })
      .expect(200);
    await sweep(new Date('2027-03-12T06:00:00Z'));
    expect(await dueRows(owner.id)).toHaveLength(2);
  });

  it('a deleted (DEACTIVATED) farm never reminds anyone', async () => {
    const { admin, owner, farm, vet } = await setup();
    await create(owner.accessToken, farm.id, {
      scheduledFor: '2027-03-10',
      assignedVeterinarianUserId: vet.id,
    });
    await request(app)
      .delete(`/api/v1/admin/organizations/${farm.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((await sweep(new Date('2027-03-10T06:00:00Z'))).due).toBe(0);
    expect(await dueRows(owner.id)).toHaveLength(0);
    expect(await dueRows(vet.id)).toHaveLength(0);
  });
});

describe('vaccination due → automatic pet owner reminder (VaccinationDueNotifier)', () => {
  async function setup() {
    const admin = await registerAdmin(app);
    const clinicOwner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة الرحمة',
    });
    const animal = await createAnimal(app, petOwner.accessToken, { name: 'Milo', breed: 'Husky' });
    await openClinicPet(app, clinicOwner.accessToken, clinic.id, animal.publicCode);
    await registerDevice(app, petOwner.accessToken, {
      token: 'pet-owner-token-cccccccccc',
      platform: 'android',
    });
    return { clinicOwner, petOwner, clinic, animal };
  }
  const sweep = (now = new Date()) => container.vaccinationDueNotifier.runOnce(now);

  it('reminds the current owner inside the window (in-app + push, personalised), exactly once per due date', async () => {
    const { clinicOwner, petOwner, clinic, animal } = await setup();
    const today = businessToday();
    const soon = await createVaccination(app, clinicOwner.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -30),
      nextDueOn: addDays(today, 2),
    });
    // Outside the window — not yet.
    await createVaccination(app, clinicOwner.accessToken, clinic.id, animal.id, {
      vaccineName: 'Parvo',
      administeredOn: addDays(today, -30),
      nextDueOn: addDays(today, 10),
    });
    // VACCINATION_ADDED rows come from creation — only count VACCINATION_DUE below.
    expect((await sweep()).due).toBe(1);

    const rows = await rowsFor(petOwner.id, 'VACCINATION_DUE');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source_event_key).toBe(`vaccination.due:${soon.id}:${addDays(today, 2)}`);
    const row = await getTestDb()('notifications')
      .where({ recipient_user_id: petOwner.id, type: 'VACCINATION_DUE' })
      .first<{ body: string; entity_id: string }>();
    expect(row?.body).toBe('تذكير من عيادة الرحمة: حان موعد تطعيم Milo.');
    expect(row?.entity_id).toBe(soon.id);
    await tick(200);
    const pushes = push.sent.filter(
      (s) => s.tokens.includes('pet-owner-token-cccccccccc') && s.data?.type === 'VACCINATION_DUE',
    );
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.data).toMatchObject({ vaccinationId: soon.id, animalId: animal.id });

    // Re-runs (every hour, restarts, a second node) never duplicate.
    expect((await sweep()).due).toBe(0);
    await sweep();
    expect(await rowsFor(petOwner.id, 'VACCINATION_DUE', 2, 300)).toHaveLength(1);
  });

  it('timing: the window opens 3 days before the due date (business day, due day included) and a moved date re-arms', async () => {
    const { clinicOwner, petOwner, clinic, animal } = await setup();
    const today = businessToday();
    const v = await createVaccination(app, clinicOwner.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -30),
      nextDueOn: addDays(today, 4),
    });
    expect((await sweep()).due).toBe(0); // 4 days away → too early
    const threeDaysEarlier = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    expect((await sweep(threeDaysEarlier)).due).toBe(1); // tomorrow: due in 3 days
    expect(await rowsFor(petOwner.id, 'VACCINATION_DUE')).toHaveLength(1);

    // The clinic reschedules → a new reminder for the new date.
    await request(app)
      .patch(`/api/v1/organizations/${clinic.id}/animals/${animal.id}/vaccinations/${v.id}`)
      .set(bearer(clinicOwner.accessToken))
      .send({ nextDueOn: addDays(today, 1) })
      .expect(200);
    expect((await sweep()).due).toBe(1);
    expect(await rowsFor(petOwner.id, 'VACCINATION_DUE', 2)).toHaveLength(2);
  });

  it('skips completed / cancelled vaccinations, past due dates and owners whose account is not ACTIVE', async () => {
    const { clinicOwner, petOwner, clinic, animal } = await setup();
    const today = businessToday();
    const done = await createVaccination(app, clinicOwner.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -30),
      nextDueOn: addDays(today, 1),
    });
    await request(app)
      .patch(`/api/v1/organizations/${clinic.id}/animals/${animal.id}/vaccinations/${done.id}`)
      .set(bearer(clinicOwner.accessToken))
      .send({ status: 'COMPLETED' })
      .expect(200);
    await createVaccination(app, clinicOwner.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -60),
      nextDueOn: addDays(today, -1),
    });
    expect((await sweep()).due).toBe(0);

    await createVaccination(app, clinicOwner.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -30),
      nextDueOn: today,
    });
    await getTestDb()('users').where({ id: petOwner.id }).update({ status: 'SUSPENDED' });
    expect((await sweep()).due).toBe(0);
    await getTestDb()('users').where({ id: petOwner.id }).update({ status: 'ACTIVE' });
    expect((await sweep()).due).toBe(1);
  });

  it('a push failure never loses the in-app reminder, and one bad row never stops the sweep', async () => {
    const { clinicOwner, petOwner, clinic, animal } = await setup();
    const today = businessToday();
    await createVaccination(app, clinicOwner.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -30),
      nextDueOn: addDays(today, 1),
    });
    await createVaccination(app, clinicOwner.accessToken, clinic.id, animal.id, {
      vaccineName: 'Parvo',
      administeredOn: addDays(today, -30),
      nextDueOn: addDays(today, 2),
    });
    // Let the creation-time VACCINATION_ADDED deliveries settle first.
    await rowsFor(petOwner.id, 'VACCINATION_ADDED', 2);
    push.failNextWith(new Error('FCM unavailable'));
    const deliver = container.notificationService.deliverSpecs.bind(container.notificationService);
    let failed = false;
    container.notificationService.deliverSpecs = async (specs) => {
      if (!failed && specs[0]?.type === 'VACCINATION_DUE') {
        failed = true;
        throw new Error('db hiccup');
      }
      return deliver(specs);
    };
    try {
      expect((await sweep()).due).toBe(2);
    } finally {
      container.notificationService.deliverSpecs = deliver;
    }
    // The second row was delivered despite the first failing; the failed one
    // is picked up by the next sweep (not yet reminded → still selected).
    expect(await rowsFor(petOwner.id, 'VACCINATION_DUE')).toHaveLength(1);
    expect((await sweep()).due).toBe(1);
    expect(await rowsFor(petOwner.id, 'VACCINATION_DUE', 2)).toHaveLength(2);
  });
});
