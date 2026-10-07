import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { businessToday } from '../../src/shared/time/business-date.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { buildRealtimeHarness, TestWs, type RealtimeHarness } from '../helpers/realtime.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createAnimal,
  grantVeterinaryAccess,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  startConversation,
} from '../helpers/factories.js';

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

async function setPeriod(organizationId: string, start: string | null, end: string | null) {
  await getTestDb()('clinic_details')
    .where({ organization_id: organizationId })
    .update({ subscription_start_date: start, subscription_end_date: end });
}

async function setStatus(organizationId: string, status: string) {
  await getTestDb()('organizations').where({ id: organizationId }).update({ status });
}

async function setup() {
  const app = harness.app;
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const staff = await registerUser(app);
  const petOwner = await registerUser(app);
  const newcomer = await registerApprovedVet(app);
  const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Operability Clinic',
  });
  await addOrganizationMember(app, owner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, owner.accessToken, clinic.id, {
    userId: staff.id,
    role: 'STAFF',
  });
  const animal = await createAnimal(app, petOwner.accessToken, { name: 'Milo' });
  await grantVeterinaryAccess(app, owner.accessToken, clinic.id, animal.id);
  const conv = await startConversation(app, petOwner.accessToken, clinic.id);
  const today = businessToday();
  await setPeriod(clinic.id, addDays(today, -30), addDays(today, 30));
  return { app, admin, owner, vet, staff, petOwner, newcomer, clinic, animal, conv, today };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/** Every clinic-operation surface, as [label, request-builder] pairs. */
function clinicOperations(ctx: Ctx, token: string) {
  const { app, clinic, animal, newcomer } = ctx;
  const org = `${API}/organizations/${clinic.id}`;
  const a = `${org}/animals/${animal.id}`;
  const when = new Date(Date.now() + 3 * 3_600_000).toISOString();
  return [
    [
      'dashboard summary',
      () => request(app).get(`${org}/clinic-dashboard/summary`).set(bearer(token)),
    ],
    ['animal list', () => request(app).get(`${org}/animal-access`).set(bearer(token))],
    ['animal profile', () => request(app).get(a).set(bearer(token))],
    ['medical records list', () => request(app).get(`${a}/medical-records`).set(bearer(token))],
    [
      'medical record create',
      () => request(app).post(`${a}/medical-records`).set(bearer(token)).send({ diagnosis: 'x' }),
    ],
    [
      'vaccination create',
      () =>
        request(app)
          .post(`${a}/vaccinations`)
          .set(bearer(token))
          .send({ vaccineName: 'Rabies', administeredOn: ctx.today }),
    ],
    [
      'reminder create',
      () =>
        request(app)
          .post(`${a}/reminders`)
          .set(bearer(token))
          .send({ title: 'x', reminderDate: ctx.today }),
    ],
    [
      'clinic vaccinations',
      () => request(app).get(`${org}/clinic-vaccinations`).set(bearer(token)),
    ],
    ['templates', () => request(app).get(`${org}/quick-review-templates`).set(bearer(token))],
    ['appointments list', () => request(app).get(`${org}/clinic-appointments`).set(bearer(token))],
    [
      'appointment by clinic',
      () =>
        request(app)
          .post(`${org}/clinic-appointments/by-clinic`)
          .set(bearer(token))
          .send({ animalId: animal.id, visitType: 'CHECKUP', scheduledFor: when }),
    ],
    ['members list', () => request(app).get(`${org}/members`).set(bearer(token))],
    [
      'member add',
      () =>
        request(app)
          .post(`${org}/members`)
          .set(bearer(token))
          .send({ userId: newcomer.id, role: 'VETERINARIAN' }),
    ],
    [
      'profile edit',
      () => request(app).patch(org).set(bearer(token)).send({ description: 'تحديث' }),
    ],
  ] as const;
}

/** Owner-only routes (vet lacks the permission even while active). */
const OWNER_ONLY = new Set(['member add', 'profile edit']);
/** VETERINARIAN has no access to these by role. */
const VET_ALLOWED = (label: string) => !OWNER_ONLY.has(label);

async function realtimeSubscribe(token: string, conversationId: string): Promise<'ok' | 'denied'> {
  const ws = await TestWs.connect(harness.wsUrl(token));
  await ws.next('welcome');
  ws.send('subscribe', { room: `conversation:${conversationId}` });
  const msg = await Promise.race([
    ws.next('subscribed').then(() => 'ok' as const),
    ws.next('error').then(() => 'denied' as const),
  ]);
  ws.close();
  return msg;
}

describe('ACTIVE clinic (approved, subscription valid)', () => {
  it('owner and authorized vet operate; realtime allowed', async () => {
    const ctx = await setup();
    for (const [label, call] of clinicOperations(ctx, ctx.owner.accessToken)) {
      const res = await call();
      expect([200, 201], `${label} as owner → ${res.status}`).toContain(res.status);
    }
    for (const [label, call] of clinicOperations(ctx, ctx.vet.accessToken)) {
      if (!VET_ALLOWED(label)) continue;
      const res = await call();
      expect([200, 201], `${label} as vet → ${res.status}`).toContain(res.status);
    }
    expect(await realtimeSubscribe(ctx.vet.accessToken, ctx.conv.id)).toBe('ok');
  });

  it('the last day of the period is still valid (endDate = today)', async () => {
    const ctx = await setup();
    await setPeriod(ctx.clinic.id, addDays(ctx.today, -10), ctx.today);
    const res = await request(ctx.app)
      .get(`${API}/organizations/${ctx.clinic.id}/clinic-dashboard/summary`)
      .set(bearer(ctx.owner.accessToken));
    expect(res.status).toBe(200);
  });
});

describe('EXPIRED subscription', () => {
  it('denies owner AND staff on every clinic surface + realtime; renewal restores access', async () => {
    const ctx = await setup();
    await setPeriod(ctx.clinic.id, addDays(ctx.today, -60), addDays(ctx.today, -1));

    for (const token of [ctx.owner.accessToken, ctx.vet.accessToken]) {
      for (const [label, call] of clinicOperations(ctx, token)) {
        const res = await call();
        expect(res.status, `${label} → ${res.status}`).toBe(403);
        if (token === ctx.owner.accessToken) {
          expect(res.body.error.code, label).toBe('ORGANIZATION_SUBSCRIPTION_EXPIRED');
        }
      }
    }
    const staffSummary = await request(ctx.app)
      .get(`${API}/organizations/${ctx.clinic.id}/clinic-dashboard/summary`)
      .set(bearer(ctx.staff.accessToken));
    expect(staffSummary.status).toBe(403);

    // Clinic side of the chat disappears (HTTP 404 + realtime denied) …
    const clinicSide = await request(ctx.app)
      .get(`${API}/conversations/${ctx.conv.id}`)
      .set(bearer(ctx.vet.accessToken));
    expect(clinicSide.status).toBe(404);
    expect(await realtimeSubscribe(ctx.owner.accessToken, ctx.conv.id)).toBe('denied');
    // … the pet owner keeps the history read-only, and cannot book.
    const ownerRead = await request(ctx.app)
      .get(`${API}/conversations/${ctx.conv.id}/messages`)
      .set(bearer(ctx.petOwner.accessToken));
    expect(ownerRead.status).toBe(200);
    const ownerSend = await request(ctx.app)
      .post(`${API}/conversations/${ctx.conv.id}/messages`)
      .set(bearer(ctx.petOwner.accessToken))
      .send({ body: 'مرحبا' });
    expect(ownerSend.status).toBe(403);
    const booking = await request(ctx.app)
      .post(`${API}/organizations/${ctx.clinic.id}/clinic-appointments`)
      .set(bearer(ctx.petOwner.accessToken))
      .send({
        animalId: ctx.animal.id,
        visitType: 'CHECKUP',
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(booking.status).toBe(403);

    // What must stay open: the profile (for the expired screen) and renewal.
    const detail = await request(ctx.app)
      .get(`${API}/organizations/${ctx.clinic.id}`)
      .set(bearer(ctx.owner.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.details.subscriptionStatus).toBe('EXPIRED');
    const renewal = await request(ctx.app)
      .post(`${API}/organizations/${ctx.clinic.id}/subscription-renewals`)
      .set(bearer(ctx.owner.accessToken))
      .send({ note: 'تجديد' });
    expect([200, 201]).toContain(renewal.status);

    // A global ADMIN still bypasses (support / moderation).
    const asAdmin = await request(ctx.app)
      .get(`${API}/organizations/${ctx.clinic.id}/clinic-dashboard/summary`)
      .set(bearer(ctx.admin.accessToken));
    expect(asAdmin.status).toBe(200);

    // Renewal (new dates) → the same owner and vet are back, realtime too.
    await setPeriod(ctx.clinic.id, ctx.today, addDays(ctx.today, 365));
    for (const [label, call] of clinicOperations(ctx, ctx.vet.accessToken)) {
      if (!VET_ALLOWED(label)) continue;
      const res = await call();
      expect([200, 201], `${label} after renewal → ${res.status}`).toContain(res.status);
    }
    const ownerAgain = await request(ctx.app)
      .get(`${API}/organizations/${ctx.clinic.id}/clinic-dashboard/summary`)
      .set(bearer(ctx.owner.accessToken));
    expect(ownerAgain.status).toBe(200);
    expect(await realtimeSubscribe(ctx.vet.accessToken, ctx.conv.id)).toBe('ok');
  });
});

describe('PENDING approval (and other inactive states)', () => {
  it('denies owner AND staff everywhere + realtime; the owner can still open the profile', async () => {
    const ctx = await setup();
    await setStatus(ctx.clinic.id, 'PENDING');

    for (const token of [ctx.owner.accessToken, ctx.vet.accessToken]) {
      for (const [label, call] of clinicOperations(ctx, token)) {
        if (label === 'profile edit') continue; // owner may still correct a pending registration
        const res = await call();
        expect(res.status, `${label} → ${res.status}`).toBe(403);
        expect(res.body.error.code, label).toBe('ORGANIZATION_NOT_ACTIVE');
      }
    }
    expect(await realtimeSubscribe(ctx.owner.accessToken, ctx.conv.id)).toBe('denied');
    expect(await realtimeSubscribe(ctx.vet.accessToken, ctx.conv.id)).toBe('denied');
    const ownerDetail = await request(ctx.app)
      .get(`${API}/organizations/${ctx.clinic.id}`)
      .set(bearer(ctx.owner.accessToken));
    expect(ownerDetail.status).toBe(200);
    expect(ownerDetail.body.data.status).toBe('PENDING');

    await setStatus(ctx.clinic.id, 'SUSPENDED');
    expect(await realtimeSubscribe(ctx.vet.accessToken, ctx.conv.id)).toBe('denied');

    // Approval restores access.
    await setStatus(ctx.clinic.id, 'ACTIVE');
    const back = await request(ctx.app)
      .get(`${API}/organizations/${ctx.clinic.id}/clinic-dashboard/summary`)
      .set(bearer(ctx.vet.accessToken));
    expect(back.status).toBe(200);
  });
});

describe('scope: Veterinary Office behaviour unchanged', () => {
  it('an expired office can still list its members (only clinics gained the member gate)', async () => {
    const ctx = await setup();
    const office = await createActiveOrganization(
      ctx.app,
      ctx.newcomer.accessToken,
      ctx.admin.accessToken,
      {
        type: 'VETERINARY_OFFICE',
        name: 'Office',
      },
    );
    await getTestDb()('veterinary_office_details')
      .where({ organization_id: office.id })
      .update({
        subscription_start_date: addDays(ctx.today, -60),
        subscription_end_date: addDays(ctx.today, -1),
      });
    const members = await request(ctx.app)
      .get(`${API}/organizations/${office.id}/members`)
      .set(bearer(ctx.newcomer.accessToken));
    expect(members.status).toBe(200);
  });
});
