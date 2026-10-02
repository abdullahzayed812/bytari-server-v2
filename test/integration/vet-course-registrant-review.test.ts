import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createVetCourse,
  listNotifications,
  registerAdmin,
  registerApprovedVet,
  registerForVetCourse,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

/** Final corrections §3 — registrants are reviewed by management, with counters. */
describe('course / seminar registrants — review, counters, "my registrations"', () => {
  it('a registration starts PENDING; the admin list and dashboard show the pending counter', async () => {
    const admin = await registerAdmin(app);
    const course = await createVetCourse(app, admin.accessToken, { capacity: 2 });
    const vet = await registerApprovedVet(app);
    const reg = await registerForVetCourse(app, vet.accessToken, course.id);
    expect(reg.status).toBe(201);
    expect(reg.body.data.status).toBe('PENDING');

    const list = await request(app)
      .get('/api/v1/admin/vet-courses?status=APPROVED&type=COURSE')
      .set(bearer(admin.accessToken));
    const row = (list.body.data as Array<{ id: string; pendingRegistrationCount: number }>).find(
      (c) => c.id === course.id,
    );
    expect(row?.pendingRegistrationCount).toBe(1);

    const dash = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(admin.accessToken));
    const card = (
      dash.body.data.cards as Array<{ id: string; pendingRegistrations?: number }>
    ).find((c) => c.id === 'courses');
    expect(card?.pendingRegistrations).toBe(1);

    const mine = await request(app)
      .get('/api/v1/vet-courses/registrations/mine')
      .set(bearer(vet.accessToken));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].course.id).toBe(course.id);
    expect(mine.body.data[0].status).toBe('PENDING');
  });

  it('admin approves / rejects registrants; the registrant is notified; a rejection frees the seat', async () => {
    const admin = await registerAdmin(app);
    const course = await createVetCourse(app, admin.accessToken, { capacity: 1 });
    const a = await registerApprovedVet(app);
    const b = await registerApprovedVet(app);
    const regA = await registerForVetCourse(app, a.accessToken, course.id);

    // Seat held by the PENDING registrant → full.
    expect((await registerForVetCourse(app, b.accessToken, course.id)).status).toBe(409);

    const rej = await request(app)
      .post(`/api/v1/admin/vet-course-registrations/${regA.body.data.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'اكتمل العدد المطلوب' });
    expect(rej.status).toBe(200);
    expect(rej.body.data.status).toBe('REJECTED');
    expect(rej.body.data.rejectionReason).toBe('اكتمل العدد المطلوب');

    // Reviewing twice is a conflict.
    const again = await request(app)
      .post(`/api/v1/admin/vet-course-registrations/${regA.body.data.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(again.status).toBe(409);

    // The seat is free again.
    const regB = await registerForVetCourse(app, b.accessToken, course.id);
    expect(regB.status).toBe(201);
    const ok = await request(app)
      .post(`/api/v1/admin/vet-course-registrations/${regB.body.data.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(ok.body.data.status).toBe('APPROVED');
    await tick();

    const nA = await listNotifications(app, a.accessToken);
    expect(nA.body.data.map((n: { type: string }) => n.type)).toContain(
      'VET_COURSE_REGISTRATION_REJECTED',
    );
    const nB = await listNotifications(app, b.accessToken);
    expect(nB.body.data.map((n: { type: string }) => n.type)).toContain(
      'VET_COURSE_REGISTRATION_APPROVED',
    );

    // PENDING filter on the registrant list
    const pending = await request(app)
      .get(`/api/v1/admin/vet-courses/${course.id}/registrations?status=PENDING`)
      .set(bearer(admin.accessToken));
    expect(pending.body.data).toHaveLength(0);
  });

  it('a non-manager cannot review registrants', async () => {
    const admin = await registerAdmin(app);
    const course = await createVetCourse(app, admin.accessToken);
    const vet = await registerApprovedVet(app);
    const reg = await registerForVetCourse(app, vet.accessToken, course.id);
    const res = await request(app)
      .post(`/api/v1/admin/vet-course-registrations/${reg.body.data.id}/approve`)
      .set(bearer(vet.accessToken));
    expect(res.status).toBe(403);
  });
});
