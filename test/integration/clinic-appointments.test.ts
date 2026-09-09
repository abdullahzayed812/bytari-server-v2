import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  approveOrganization,
  bearer,
  createActiveOrganization,
  createAnimal,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

const API = '/api/v1';
const soon = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString();

async function book(
  token: string,
  organizationId: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app)
    .post(`${API}/organizations/${organizationId}/clinic-appointments`)
    .set(bearer(token))
    .send(body);
}

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const vet = await registerApprovedVet(app);
  const owner = await registerUser(app);
  const clinic = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'عيادة الرحمة',
  });
  const pet = await createAnimal(app, owner.accessToken, { name: 'كوكو', species: 'DOG' });
  return { admin, vet, owner, clinic, pet };
}

describe('clinic appointments — booking (pet owner)', () => {
  it('books an appointment for the caller’s own pet; it starts PENDING', async () => {
    const { owner, clinic, pet } = await setup();

    const res = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'FOLLOW_UP',
      scheduledFor: soon(2),
      note: 'حجز موعد عملية التعقييم',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      visitType: 'FOLLOW_UP',
      note: 'حجز موعد عملية التعقييم',
      petOwnerUserId: owner.id,
      viewerSide: 'PET_OWNER',
      animal: { id: pet.id, name: 'كوكو' },
      organization: { id: clinic.id, name: 'عيادة الرحمة' },
    });
  });

  it('rejects required fields (422)', async () => {
    const { owner, clinic } = await setup();
    const res = await book(owner.accessToken, clinic.id, { visitType: 'CHECKUP' });
    expect(res.status).toBe(422);
  });

  it('rejects a past date/time (CLINIC_APPOINTMENT_IN_PAST)', async () => {
    const { owner, clinic, pet } = await setup();
    const res = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(-1),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CLINIC_APPOINTMENT_IN_PAST');
  });

  it('refuses booking a pet the caller does not own (404 — hides existence)', async () => {
    const { clinic, pet } = await setup();
    const stranger = await registerUser(app);
    const res = await book(stranger.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });
    expect(res.status).toBe(404);
  });

  it('refuses booking with a non-CLINIC or inactive organization', async () => {
    const { admin, vet, owner, pet } = await setup();
    const pendingClinic = await createOrganization(app, vet.accessToken, { type: 'CLINIC' });
    const pending = await book(owner.accessToken, pendingClinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });
    expect(pending.status).toBe(403);
    expect(pending.body.error.code).toBe('ORGANIZATION_NOT_ACTIVE');

    await approveOrganization(app, admin.accessToken, pendingClinic.id);
    const ok = await book(owner.accessToken, pendingClinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });
    expect(ok.status).toBe(201);
  });
});

describe('clinic appointments — list & details (ownership isolation)', () => {
  it('lists only the caller’s own appointments and supports the status filter', async () => {
    const { owner, clinic, pet } = await setup();
    const other = await registerUser(app);
    const otherPet = await createAnimal(app, other.accessToken);

    const a = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });
    await book(other.accessToken, clinic.id, {
      animalId: otherPet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(3),
    });

    const mine = await request(app)
      .get(`${API}/clinic-appointments`)
      .set(bearer(owner.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].id).toBe(a.body.data.id);

    const pending = await request(app)
      .get(`${API}/clinic-appointments?status=PENDING`)
      .set(bearer(owner.accessToken));
    expect(pending.body.data).toHaveLength(1);
    const confirmed = await request(app)
      .get(`${API}/clinic-appointments?status=CONFIRMED`)
      .set(bearer(owner.accessToken));
    expect(confirmed.body.data).toHaveLength(0);
  });

  it('prevents another user from reading someone else’s appointment (404)', async () => {
    const { owner, clinic, pet } = await setup();
    const attacker = await registerUser(app);
    const a = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });

    const res = await request(app)
      .get(`${API}/clinic-appointments/${a.body.data.id}`)
      .set(bearer(attacker.accessToken));
    expect(res.status).toBe(404);
  });

  it('returns the appointment history timeline', async () => {
    const { owner, clinic, pet } = await setup();
    const a = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });

    const res = await request(app)
      .get(`${API}/clinic-appointments/${a.body.data.id}/history`)
      .set(bearer(owner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ kind: 'REQUESTED', actorSide: 'PET_OWNER' }),
    ]);
  });
});

describe('clinic appointments — lifecycle (clinic dashboard APIs + pet-owner response)', () => {
  it('runs request → clinic confirm → complete', async () => {
    const { admin, vet: staffVet, owner, clinic, pet } = await setup();
    // A second APPROVED vet added as a clinic member drives the desk — proving
    // the clinic side is "any ACTIVE member", not just the owner.
    const staff = await registerApprovedVet(app);
    await addOrganizationMember(app, staffVet.accessToken, clinic.id, {
      userId: staff.id,
      role: 'VETERINARIAN',
    });
    void admin;
    const vet = staffVet;

    const a = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'FOLLOW_UP',
      scheduledFor: soon(2),
    });
    const id = a.body.data.id;

    const confirm = await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-appointments/${id}/confirm`)
      .set(bearer(staff.accessToken));
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('CONFIRMED');

    const complete = await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-appointments/${id}/complete`)
      .set(bearer(vet.accessToken));
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('COMPLETED');

    // owner sees the final state on their own list
    const mine = await request(app)
      .get(`${API}/clinic-appointments/${id}`)
      .set(bearer(owner.accessToken));
    expect(mine.body.data.status).toBe('COMPLETED');
  });

  it('clinic proposes a reschedule; the owner accepts → CONFIRMED at the new slot', async () => {
    const { vet, owner, clinic, pet } = await setup();
    const a = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });
    const id = a.body.data.id;
    const newSlot = soon(5);

    const proposal = await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-appointments/${id}/reschedule`)
      .set(bearer(vet.accessToken))
      .send({ proposedScheduledFor: newSlot, reason: 'الطبيب غير متاح' });
    expect(proposal.status).toBe(200);
    expect(proposal.body.data).toMatchObject({
      status: 'RESCHEDULE_PROPOSED',
      proposedScheduledFor: newSlot,
    });

    const accept = await request(app)
      .post(`${API}/clinic-appointments/${id}/reschedule-response`)
      .set(bearer(owner.accessToken))
      .send({ accept: true });
    expect(accept.status).toBe(200);
    expect(accept.body.data).toMatchObject({
      status: 'CONFIRMED',
      scheduledFor: newSlot,
      proposedScheduledFor: null,
    });
  });

  it('the owner cancels an open appointment; a second cancel is a 409', async () => {
    const { owner, clinic, pet } = await setup();
    const a = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });
    const id = a.body.data.id;

    const first = await request(app)
      .post(`${API}/clinic-appointments/${id}/cancel`)
      .set(bearer(owner.accessToken));
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('CANCELLED');

    const second = await request(app)
      .post(`${API}/clinic-appointments/${id}/cancel`)
      .set(bearer(owner.accessToken));
    expect(second.status).toBe(409);
  });

  it('a non-member cannot drive the clinic-side APIs (403)', async () => {
    const { owner, clinic, pet } = await setup();
    const outsider = await registerUser(app);
    const a = await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });

    const res = await request(app)
      .post(`${API}/organizations/${clinic.id}/clinic-appointments/${a.body.data.id}/confirm`)
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(403);
  });

  it('the clinic dashboard list is scoped to the organization and needs clinic.appointment.read', async () => {
    const { vet, owner, clinic, pet } = await setup();
    await book(owner.accessToken, clinic.id, {
      animalId: pet.id,
      visitType: 'CHECKUP',
      scheduledFor: soon(2),
    });

    const asClinic = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-appointments`)
      .set(bearer(vet.accessToken));
    expect(asClinic.status).toBe(200);
    expect(asClinic.body.data).toHaveLength(1);
    expect(asClinic.body.data[0].viewerSide).toBe('CLINIC');

    const asOwner = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-appointments`)
      .set(bearer(owner.accessToken));
    expect(asOwner.status).toBe(403);
  });
});
