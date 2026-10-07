import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { businessToday } from '../../src/shared/time/business-date.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createAnimal,
  createMedicalRecord,
  createVaccination,
  fixtureBytes,
  grantVeterinaryAccess,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  startConversation,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();
const API = '/api/v1';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function setup() {
  const admin = await registerAdmin(app);
  const clinicOwner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const staff = await registerUser(app);
  const petOwner = await registerUser(app);
  const otherOwner = await registerApprovedVet(app);
  const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Parity Clinic',
  });
  const otherClinic = await createActiveOrganization(
    app,
    otherOwner.accessToken,
    admin.accessToken,
    { type: 'CLINIC', name: 'Other Clinic' },
  );
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: staff.id,
    role: 'STAFF',
  });
  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Milo', breed: 'Husky' });
  await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, animal.id);
  return { admin, clinicOwner, vet, staff, petOwner, otherOwner, clinic, otherClinic, animal };
}

const base = (orgId: string, animalId: string) =>
  `${API}/organizations/${orgId}/animals/${animalId}`;

describe('medical records — legacy full exam / lab / file fields + attachments', () => {
  it('stores every legacy field and only accepts this clinic’s uploaded attachment keys', async () => {
    const { vet, clinic, otherClinic, otherOwner, animal } = await setup();

    const presign = await request(app)
      .post(`${base(clinic.id, animal.id)}/medical-records/attachments/upload-url`)
      .set(bearer(vet.accessToken))
      .send({ filename: 'rx.jpg', mimeType: 'image/jpeg', size: 2048 });
    expect(presign.status).toBe(201);
    const key: string = presign.body.data.storageKey;
    expect(key.startsWith(`medical-records/${clinic.id}/`)).toBe(true);
    await container.objectStorage.put(key, fixtureBytes('image/jpeg', 2048), {
      contentType: 'image/jpeg',
    });

    const create = await request(app)
      .post(`${base(clinic.id, animal.id)}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({
        diagnosis: 'التهاب',
        treatment: 'مضاد حيوي',
        symptoms: 'حرارة',
        severity: 'SEVERE',
        labNotes: 'CBC normal',
        notes: 'متابعة',
        recordType: 'FULL_EXAM',
        isDraft: true,
        prescriptionKey: key,
        attachmentKeys: [],
      });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({
      symptoms: 'حرارة',
      severity: 'SEVERE',
      labNotes: 'CBC normal',
      recordType: 'FULL_EXAM',
      isDraft: true,
      prescriptionKey: key,
    });
    expect(create.body.data.prescriptionUrl).toEqual(expect.any(String));

    // Another clinic's key (or a missing object) is rejected.
    const foreign = await request(app)
      .post(
        `${API}/organizations/${otherClinic.id}/animals/${animal.id}/medical-records/attachments/upload-url`,
      )
      .set(bearer(otherOwner.accessToken))
      .send({ filename: 'x.jpg', mimeType: 'image/jpeg', size: 10 });
    expect(foreign.status).toBe(404); // other clinic has no grant for the animal
    const bad = await request(app)
      .post(`${base(clinic.id, animal.id)}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({
        labNotes: 'x',
        recordType: 'LAB',
        attachmentKeys: [`medical-records/${otherClinic.id}/a.jpg`],
      });
    expect(bad.status).toBe(409);

    // Edit flips the draft and keeps the existing key; owner sees the same fields.
    const patch = await request(app)
      .patch(`${base(clinic.id, animal.id)}/medical-records/${create.body.data.id}`)
      .set(bearer(vet.accessToken))
      .send({ isDraft: false, severity: 'MILD' });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({
      isDraft: false,
      severity: 'MILD',
      prescriptionKey: key,
    });
  });

  it('a lab-only record (no diagnosis) is accepted, as in the legacy lab tab', async () => {
    const { vet, clinic, animal } = await setup();
    const res = await request(app)
      .post(`${base(clinic.id, animal.id)}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ labNotes: 'Glucose 90', recordType: 'LAB' });
    expect(res.status).toBe(201);
  });
});

describe('vaccinations — status, clinic-wide list, notify owner', () => {
  it('derives a default status, filters OVERDUE / DUE_TODAY, exposes owner contact, and notifies the owner', async () => {
    const { vet, staff, clinic, animal, petOwner } = await setup();
    const today = businessToday();
    const overdue = await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -30),
      nextDueOn: addDays(today, -1),
    });
    await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -10),
      nextDueOn: today,
    });
    const done = await createVaccination(app, vet.accessToken, clinic.id, animal.id, {
      administeredOn: addDays(today, -5),
    });
    await tick();
    const added = await container
      .db('notifications')
      .where({ recipient_user_id: petOwner.id, type: 'VACCINATION_ADDED' });
    expect(added).toHaveLength(3);

    const all = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-vaccinations`)
      .set(bearer(vet.accessToken));
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(3);
    expect(all.body.data[0].owner).toMatchObject({ id: petOwner.id, phone: expect.anything() });
    expect(
      all.body.data.find((x: { vaccination: { id: string } }) => x.vaccination.id === done.id)
        .vaccination.status,
    ).toBe('COMPLETED');

    const overdueList = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-vaccinations?status=OVERDUE`)
      .set(bearer(vet.accessToken));
    expect(
      overdueList.body.data.map((x: { vaccination: { id: string } }) => x.vaccination.id),
    ).toEqual([overdue.id]);
    expect(overdueList.body.data[0].isOverdue).toBe(true);
    const dueToday = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-vaccinations?status=DUE_TODAY`)
      .set(bearer(vet.accessToken));
    expect(dueToday.body.data).toHaveLength(1);

    // Mark complete via the existing PATCH; reschedule = PATCH nextDueOn.
    const complete = await request(app)
      .patch(`${base(clinic.id, animal.id)}/vaccinations/${overdue.id}`)
      .set(bearer(vet.accessToken))
      .send({ status: 'COMPLETED' });
    expect(complete.body.data.status).toBe('COMPLETED');

    const notify = await request(app)
      .post(`${base(clinic.id, animal.id)}/vaccinations/${done.id}/notify`)
      .set(bearer(vet.accessToken));
    expect(notify.body.data).toEqual({ notified: true });
    await tick();
    const due = await container
      .db('notifications')
      .where({ recipient_user_id: petOwner.id, type: 'VACCINATION_DUE' });
    expect(due).toHaveLength(1);

    // STAFF has no vaccination.read.
    const asStaff = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-vaccinations`)
      .set(bearer(staff.accessToken));
    expect(asStaff.status).toBe(403);
  });
});

describe('reminders (legacy pet_reminders)', () => {
  it('clinic CRUD + complete + clinic list; owner reads + deletes; other clinics are isolated', async () => {
    const { vet, staff, clinic, otherClinic, otherOwner, animal, petOwner } = await setup();
    const today = businessToday();

    const created = await request(app)
      .post(`${base(clinic.id, animal.id)}/reminders`)
      .set(bearer(vet.accessToken))
      .send({
        title: 'فحص دوري',
        description: 'بعد أسبوع',
        reminderDate: today,
        reminderType: 'CHECKUP',
      });
    expect(created.status).toBe(201);
    const id: string = created.body.data.id;
    expect(created.body.data).toMatchObject({ reminderType: 'CHECKUP', isCompleted: false });
    await tick();
    expect(
      await container
        .db('notifications')
        .where({ recipient_user_id: petOwner.id, type: 'REMINDER_ADDED' }),
    ).toHaveLength(1);

    const todayList = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-reminders?status=TODAY`)
      .set(bearer(vet.accessToken));
    expect(todayList.body.data).toHaveLength(1);
    expect(todayList.body.data[0].owner.id).toBe(petOwner.id);

    const sendToday = await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-reminders/notify-today`)
      .set(bearer(vet.accessToken));
    expect(sendToday.body.data).toEqual({ sent: 1 });
    await tick();
    expect(
      await container
        .db('notifications')
        .where({ recipient_user_id: petOwner.id, type: 'REMINDER_DUE' }),
    ).toHaveLength(1);

    const reschedule = await request(app)
      .patch(`${base(clinic.id, animal.id)}/reminders/${id}`)
      .set(bearer(vet.accessToken))
      .send({ reminderDate: addDays(today, 3), isCompleted: true });
    expect(reschedule.body.data).toMatchObject({
      reminderDate: addDays(today, 3),
      isCompleted: true,
    });
    expect(reschedule.body.data.completedAt).toEqual(expect.any(String));

    // Another clinic: no grant → 404; with its own grant it still cannot edit this clinic's reminder.
    const cross = await request(app)
      .get(`${API}/organizations/${otherClinic.id}/animals/${animal.id}/reminders`)
      .set(bearer(otherOwner.accessToken));
    expect(cross.status).toBe(404);
    await grantVeterinaryAccess(app, otherOwner.accessToken, otherClinic.id, animal.id);
    const crossEdit = await request(app)
      .patch(`${API}/organizations/${otherClinic.id}/animals/${animal.id}/reminders/${id}`)
      .set(bearer(otherOwner.accessToken))
      .send({ title: 'x' });
    expect(crossEdit.status).toBe(404);

    // STAFF cannot read reminders (no medical_record.read).
    const asStaff = await request(app)
      .get(`${base(clinic.id, animal.id)}/reminders`)
      .set(bearer(staff.accessToken));
    expect(asStaff.status).toBe(403);

    // Owner reads + deletes; a stranger gets 404.
    const ownerList = await request(app)
      .get(`${API}/animals/${animal.id}/reminders`)
      .set(bearer(petOwner.accessToken));
    expect(ownerList.body.data).toHaveLength(1);
    const stranger = await request(app)
      .delete(`${API}/animals/${animal.id}/reminders/${id}`)
      .set(bearer(otherOwner.accessToken));
    expect(stranger.status).toBe(404);
    const del = await request(app)
      .delete(`${API}/animals/${animal.id}/reminders/${id}`)
      .set(bearer(petOwner.accessToken));
    expect(del.status).toBe(200);
  });
});

describe('quick-review templates', () => {
  it('owner manages, vet only reads, other clinic cannot touch them', async () => {
    const { clinicOwner, vet, clinic, otherClinic, otherOwner } = await setup();
    const create = await request(app)
      .post(`${API}/organizations/${clinic.id}/quick-review-templates`)
      .set(bearer(clinicOwner.accessToken))
      .send({
        name: 'لقاح سعار',
        templateType: 'VACCINE',
        defaultNotes: 'سنوي',
        intervalDays: 365,
      });
    expect(create.status).toBe(201);
    const id: string = create.body.data.id;

    const asVet = await request(app)
      .post(`${API}/organizations/${clinic.id}/quick-review-templates`)
      .set(bearer(vet.accessToken))
      .send({ name: 'x' });
    expect(asVet.status).toBe(403);
    const vetList = await request(app)
      .get(`${API}/organizations/${clinic.id}/quick-review-templates`)
      .set(bearer(vet.accessToken));
    expect(vetList.body.data).toHaveLength(1);

    const crossPatch = await request(app)
      .patch(`${API}/organizations/${otherClinic.id}/quick-review-templates/${id}`)
      .set(bearer(otherOwner.accessToken))
      .send({ name: 'hijack' });
    expect(crossPatch.status).toBe(404);

    const patch = await request(app)
      .patch(`${API}/organizations/${clinic.id}/quick-review-templates/${id}`)
      .set(bearer(clinicOwner.accessToken))
      .send({ intervalDays: null, templateType: 'TREATMENT' });
    expect(patch.body.data).toMatchObject({ intervalDays: null, templateType: 'TREATMENT' });
    const del = await request(app)
      .delete(`${API}/organizations/${clinic.id}/quick-review-templates/${id}`)
      .set(bearer(clinicOwner.accessToken));
    expect(del.status).toBe(200);
  });
});

describe('animal profile parity + clinic view', () => {
  it('owner sets weight / neutered; only ADMIN edits medicalHistory; clinic sees owner contact', async () => {
    const { admin, vet, clinic, animal, petOwner } = await setup();
    const asOwner = await request(app)
      .patch(`${API}/animals/${animal.id}`)
      .set(bearer(petOwner.accessToken))
      .send({ weightKg: 12.5, isNeutered: true });
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.data).toMatchObject({ weightKg: 12.5, isNeutered: true });
    const historyAsOwner = await request(app)
      .patch(`${API}/animals/${animal.id}`)
      .set(bearer(petOwner.accessToken))
      .send({ medicalHistory: 'x' });
    expect(historyAsOwner.status).toBe(403);
    const historyAsAdmin = await request(app)
      .patch(`${API}/animals/${animal.id}`)
      .set(bearer(admin.accessToken))
      .send({ medicalHistory: 'حساسية من البنسلين' });
    expect(historyAsAdmin.body.data.medicalHistory).toBe('حساسية من البنسلين');

    const profile = await request(app)
      .get(`${API}/organizations/${clinic.id}/animals/${animal.id}`)
      .set(bearer(vet.accessToken));
    expect(profile.body.data).toMatchObject({
      weightKg: 12.5,
      isNeutered: true,
      medicalHistory: 'حساسية من البنسلين',
      owner: { id: petOwner.id },
    });
    expect(profile.body.data).not.toHaveProperty('notes');

    const search = await request(app)
      .get(`${API}/organizations/${clinic.id}/animal-access?search=hus`)
      .set(bearer(vet.accessToken));
    expect(search.body.data).toHaveLength(1);
    const byId = await request(app)
      .get(`${API}/organizations/${clinic.id}/animal-access?search=${animal.id}`)
      .set(bearer(vet.accessToken));
    expect(byId.body.data).toHaveLength(1);
    const miss = await request(app)
      .get(`${API}/organizations/${clinic.id}/animal-access?search=zzz`)
      .set(bearer(vet.accessToken));
    expect(miss.body.data).toHaveLength(0);
  });

  it('owner "clinics" tab lists clinics that treat / recorded the pet', async () => {
    const { vet, clinic, animal, petOwner, otherOwner } = await setup();
    await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    const res = await request(app)
      .get(`${API}/animals/${animal.id}/clinics`)
      .set(bearer(petOwner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        organizationId: clinic.id,
        hasActiveAccess: true,
        medicalRecordsCount: 1,
      }),
    ]);
    const stranger = await request(app)
      .get(`${API}/animals/${animal.id}/clinics`)
      .set(bearer(otherOwner.accessToken));
    expect(stranger.status).toBe(404);
  });
});

describe('clinic appointments — clinic-created, remind, delete', () => {
  it('requires the grant, notifies the owner, and deletes only COMPLETED', async () => {
    const { vet, clinic, otherClinic, otherOwner, animal, petOwner } = await setup();
    const when = new Date(Date.now() + 2 * 3_600_000).toISOString();

    const noGrant = await request(app)
      .post(`${API}/organizations/${otherClinic.id}/clinic-appointments/by-clinic`)
      .set(bearer(otherOwner.accessToken))
      .send({ animalId: animal.id, visitType: 'CHECKUP', scheduledFor: when });
    expect(noGrant.status).toBe(404);

    const created = await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-appointments/by-clinic`)
      .set(bearer(vet.accessToken))
      .send({
        animalId: animal.id,
        visitType: 'VACCINATION',
        scheduledFor: when,
        note: 'جرعة ثانية',
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'CONFIRMED', petOwnerUserId: petOwner.id });
    const id: string = created.body.data.id;

    const remind = await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-appointments/${id}/remind`)
      .set(bearer(vet.accessToken));
    expect(remind.body.data).toEqual({ notified: true });
    await tick();
    const types = (
      await container.db('notifications').where({ recipient_user_id: petOwner.id }).select('type')
    ).map((r: { type: string }) => r.type);
    expect(types).toEqual(
      expect.arrayContaining(['CLINIC_APPOINTMENT_CREATED', 'CLINIC_APPOINTMENT_REMINDER']),
    );

    const tooEarly = await request(app)
      .delete(`${API}/organizations/${clinic.id}/clinic-appointments/${id}`)
      .set(bearer(vet.accessToken));
    expect(tooEarly.status).toBe(409);
    await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-appointments/${id}/complete`)
      .set(bearer(vet.accessToken))
      .expect(200);
    const del = await request(app)
      .delete(`${API}/organizations/${clinic.id}/clinic-appointments/${id}`)
      .set(bearer(vet.accessToken));
    expect(del.status).toBe(200);
  });
});

describe('clinic visitors broadcast + chat pause', () => {
  it('reaches the owners of treated animals; clinic-only; pause blocks messages', async () => {
    const { admin, clinicOwner, clinic, animal, petOwner, otherOwner } = await setup();
    const send = await request(app)
      .post(`${API}/organizations/${clinic.id}/broadcast`)
      .set(bearer(clinicOwner.accessToken))
      .send({ title: 'تنبيه', body: 'العيادة مغلقة غدًا', audience: 'CLINIC_VISITORS' });
    expect(send.status).toBe(201);
    await tick();
    expect(
      await container
        .db('notifications')
        .where({ recipient_user_id: petOwner.id, type: 'ORGANIZATION_BROADCAST' }),
    ).toHaveLength(1);

    const office = await createActiveOrganization(app, otherOwner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Office',
    });
    const officeVisitors = await request(app)
      .post(`${API}/organizations/${office.id}/broadcast`)
      .set(bearer(otherOwner.accessToken))
      .send({ title: 'x', body: 'y', audience: 'CLINIC_VISITORS' });
    expect(officeVisitors.status).toBe(400);

    const conv = await startConversation(app, clinicOwner.accessToken, clinic.id, petOwner.id);
    const ownerPause = await request(app)
      .post(`${API}/conversations/${conv.id}/clinic-active`)
      .set(bearer(petOwner.accessToken))
      .send({ active: false });
    expect(ownerPause.status).toBe(403);
    const pause = await request(app)
      .post(`${API}/conversations/${conv.id}/clinic-active`)
      .set(bearer(clinicOwner.accessToken))
      .send({ active: false });
    expect(pause.status).toBe(200);
    const blocked = await request(app)
      .post(`${API}/conversations/${conv.id}/messages`)
      .set(bearer(petOwner.accessToken))
      .send({ body: 'مرحبا' });
    expect(blocked.status).toBe(403);
    await request(app)
      .post(`${API}/conversations/${conv.id}/clinic-active`)
      .set(bearer(clinicOwner.accessToken))
      .send({ active: true })
      .expect(200);
    const ok = await request(app)
      .post(`${API}/conversations/${conv.id}/messages`)
      .set(bearer(petOwner.accessToken))
      .send({ body: 'مرحبا' });
    expect(ok.status).toBe(201);
    void animal;
  });
});
