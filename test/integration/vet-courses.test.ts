import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  approveVetCourse,
  assignSystemSupervisor,
  bearer,
  createVetCourse,
  registerAdmin,
  registerApprovedVet,
  registerForVetCourse,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/vet-courses${p}`;
const adminApi = (p: string): string => `/api/v1/admin${p}`;

describe('Veterinarian Courses & Seminars — courses (approved veterinarian only, moderated)', () => {
  it('a plain user cannot create a course; an approved veterinarian can, and it starts PENDING', async () => {
    const plainUser = await registerUser(app);
    const denied = await request(app)
      .post(api(''))
      .set(bearer(plainUser.accessToken))
      .send({
        type: 'COURSE',
        title: 'دورة تجريبية',
        description: 'وصف الدورة التجريبية لأغراض الاختبار.',
        organizingBody: 'جهة تجريبية',
        instructorName: 'د. تجريبي',
        startDate: '2999-01-01',
        endDate: '2999-01-02',
        locationMode: 'ONLINE',
        locationDetails: 'أونلاين',
      });
    expect(denied.status).toBe(403);

    const vet = await registerApprovedVet(app);
    const other = await registerUser(app);
    const created = await createVetCourse(app, vet.accessToken, { title: 'أساسيات التغذية' });
    expect(created.id).toBeTruthy();

    const publicList = await request(app).get(api('')).set(bearer(other.accessToken));
    expect(publicList.body.data).toHaveLength(0);

    const admin = await registerAdmin(app);
    const approve = await approveVetCourse(app, admin.accessToken, created.id);
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');

    const afterApproval = await request(app).get(api('')).set(bearer(other.accessToken));
    expect(afterApproval.body.data).toHaveLength(1);
    expect(afterApproval.body.data[0].title).toBe('أساسيات التغذية');
  });

  it('an ACTIVE VET_COURSES supervisor can moderate; the creator cannot approve their own course', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'VET_COURSES');
    const vet = await registerApprovedVet(app);

    const created = await createVetCourse(app, vet.accessToken);
    const selfApprove = await approveVetCourse(app, vet.accessToken, created.id);
    expect(selfApprove.status).toBe(403);

    const approve = await approveVetCourse(app, sup.accessToken, created.id);
    expect(approve.status).toBe(200);
  });

  it('rejects re-review of an already-decided course (409) and requires a reason to reject', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const created = await createVetCourse(app, vet.accessToken);

    const noReason = await request(app)
      .post(adminApi(`/vet-courses/${created.id}/reject`))
      .set(bearer(admin.accessToken))
      .send({});
    expect(noReason.status).toBe(422);

    const reject = await request(app)
      .post(adminApi(`/vet-courses/${created.id}/reject`))
      .set(bearer(admin.accessToken))
      .send({ reason: 'معلومات غير كافية' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('REJECTED');

    const again = await approveVetCourse(app, admin.accessToken, created.id);
    expect(again.status).toBe(409);
  });

  it('editing a rejected course resets it to PENDING for re-review', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const created = await createVetCourse(app, vet.accessToken);
    await request(app)
      .post(adminApi(`/vet-courses/${created.id}/reject`))
      .set(bearer(admin.accessToken))
      .send({ reason: 'x' });

    const edit = await request(app)
      .patch(api(`/${created.id}`))
      .set(bearer(vet.accessToken))
      .send({ title: 'أساسيات التغذية - محدثة' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.status).toBe('PENDING');
    expect(edit.body.data.rejectionReason).toBeNull();
  });

  it('the creator can cancel ("إلغاء الدورة") their own approved course; cancelled courses drop off the public list', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const other = await registerUser(app);
    const created = await createVetCourse(app, vet.accessToken);
    await approveVetCourse(app, admin.accessToken, created.id);

    const cancel = await request(app).post(api(`/${created.id}/cancel`)).set(bearer(vet.accessToken));
    expect(cancel.status).toBe(200);

    const publicList = await request(app).get(api('')).set(bearer(other.accessToken));
    expect(publicList.body.data).toHaveLength(0);

    const strangerCancel = await request(app)
      .post(api(`/${created.id}/cancel`))
      .set(bearer(other.accessToken));
    expect(strangerCancel.status).toBe(403);
  });
});

describe('Veterinarian Courses & Seminars — registration (approved veterinarian only)', () => {
  async function approvedCourse(
    creatorToken: string,
    overrides: Parameters<typeof createVetCourse>[2] = {},
  ) {
    const admin = await registerAdmin(app);
    const course = await createVetCourse(app, creatorToken, overrides);
    await approveVetCourse(app, admin.accessToken, course.id);
    return course;
  }

  it('a pet owner (non-veterinarian) cannot register', async () => {
    const creator = await registerApprovedVet(app);
    const course = await approvedCourse(creator.accessToken);
    const petOwner = await registerUser(app);

    const res = await registerForVetCourse(app, petOwner.accessToken, course.id);
    expect(res.status).toBe(403);
  });

  it('an approved veterinarian can register; cannot register twice; cannot register for their own course', async () => {
    const creator = await registerApprovedVet(app);
    const course = await approvedCourse(creator.accessToken);

    const selfRegister = await registerForVetCourse(app, creator.accessToken, course.id);
    expect(selfRegister.status).toBe(403);

    const registrant = await registerApprovedVet(app);
    const register = await registerForVetCourse(app, registrant.accessToken, course.id);
    expect(register.status).toBe(201);

    const again = await registerForVetCourse(app, registrant.accessToken, course.id);
    expect(again.status).toBe(409);
  });

  it('cannot register for a course that is not open (still PENDING moderation)', async () => {
    const creator = await registerApprovedVet(app);
    const course = await createVetCourse(app, creator.accessToken); // not approved
    const registrant = await registerApprovedVet(app);
    const res = await registerForVetCourse(app, registrant.accessToken, course.id);
    expect(res.status).toBe(409);
  });

  it('cannot register once the registration deadline has passed', async () => {
    const creator = await registerApprovedVet(app);
    const course = await approvedCourse(creator.accessToken, { registrationDeadline: '2000-01-01' });
    const registrant = await registerApprovedVet(app);
    const res = await registerForVetCourse(app, registrant.accessToken, course.id);
    expect(res.status).toBe(409);
  });

  it('enforces capacity — a full course rejects further registrations', async () => {
    const creator = await registerApprovedVet(app);
    const course = await approvedCourse(creator.accessToken, { capacity: 1 });

    const first = await registerApprovedVet(app);
    const ok = await registerForVetCourse(app, first.accessToken, course.id);
    expect(ok.status).toBe(201);

    const second = await registerApprovedVet(app);
    const full = await registerForVetCourse(app, second.accessToken, course.id);
    expect(full.status).toBe(409);
  });

  it('registrations are private to the registrant and the course creator; "دوراتي" scopes correctly', async () => {
    const creator = await registerApprovedVet(app);
    const course = await approvedCourse(creator.accessToken);
    const registrant = await registerApprovedVet(app);
    const register = await registerForVetCourse(app, registrant.accessToken, course.id);
    const stranger = await registerUser(app);

    const strangerGet = await request(app)
      .get(api(`/registrations/${register.body.data.id}`))
      .set(bearer(stranger.accessToken));
    expect(strangerGet.status).toBe(404);

    const mine = await request(app)
      .get(api('/registrations/mine'))
      .set(bearer(registrant.accessToken));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].course.id).toBe(course.id);

    const forCourse = await request(app)
      .get(api(`/${course.id}/registrations`))
      .set(bearer(creator.accessToken));
    expect(forCourse.body.data).toHaveLength(1);

    const myCourses = await request(app).get(api('/mine')).set(bearer(creator.accessToken));
    expect(myCourses.body.data).toHaveLength(1);
    expect(myCourses.body.data[0].registrationCount).toBe(1);
  });
});

describe('Veterinarian Courses & Seminars — admin oversight', () => {
  it('admin can list registrations for a course (read-only) via vet_course.read', async () => {
    const admin = await registerAdmin(app);
    const creator = await registerApprovedVet(app);
    const course = await createVetCourse(app, creator.accessToken);
    await approveVetCourse(app, admin.accessToken, course.id);
    const registrant = await registerApprovedVet(app);
    await registerForVetCourse(app, registrant.accessToken, course.id);

    const list = await request(app)
      .get(adminApi(`/vet-courses/${course.id}/registrations`))
      .set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const denied = await request(app)
      .get(adminApi(`/vet-courses/${course.id}/registrations`))
      .set(bearer(creator.accessToken));
    expect(denied.status).toBe(403);
  });

  it('an ADMIN (not also an approved veterinarian) can create a course/seminar directly', async () => {
    const admin = await registerAdmin(app);
    const plainUser = await registerUser(app);

    const created = await createVetCourse(app, admin.accessToken, {
      type: 'SEMINAR',
      title: 'ندوة إدارية من الإدارة',
    });
    expect(created.id).toBeTruthy();

    // It still starts PENDING like any other submission — no auto-approve
    // shortcut — but ADMIN already holds `vet_course.approve`, so they can
    // immediately approve their own submission (unlike a plain vet — see the
    // self-approval test above).
    const asPlainUser = await request(app)
      .get(api(`/${created.id}`))
      .set(bearer(plainUser.accessToken));
    expect(asPlainUser.status).toBe(404); // still PENDING, not public yet

    const approve = await approveVetCourse(app, admin.accessToken, created.id);
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');
  });

  it('an ADMIN can edit a course they did not create; a plain approved vet who is not the owner cannot', async () => {
    const admin = await registerAdmin(app);
    const creator = await registerApprovedVet(app);
    const otherVet = await registerApprovedVet(app);
    const course = await createVetCourse(app, creator.accessToken, { title: 'العنوان الأصلي' });

    const deniedForOtherVet = await request(app)
      .patch(api(`/${course.id}`))
      .set(bearer(otherVet.accessToken))
      .send({ title: 'محاولة تعديل من طرف آخر' });
    expect(deniedForOtherVet.status).toBe(403);

    const adminEdit = await request(app)
      .patch(api(`/${course.id}`))
      .set(bearer(admin.accessToken))
      .send({ title: 'عنوان محدّث من الإدارة' });
    expect(adminEdit.status).toBe(200);
    expect(adminEdit.body.data.title).toBe('عنوان محدّث من الإدارة');
  });

  it('admin can view every course/seminar state via explicit status filters; omitting status defaults to PENDING (same convention as vet-services/vet-jobs)', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const pending = await createVetCourse(app, vet.accessToken, { title: 'قيد الانتظار' });
    const toApprove = await createVetCourse(app, vet.accessToken, { title: 'سيُعتمد' });
    const toReject = await createVetCourse(app, vet.accessToken, { title: 'سيُرفض' });
    await approveVetCourse(app, admin.accessToken, toApprove.id);
    await request(app)
      .post(adminApi(`/vet-courses/${toReject.id}/reject`))
      .set(bearer(admin.accessToken))
      .send({ reason: 'غير مكتمل' });

    const pendingOnly = await request(app)
      .get(adminApi('/vet-courses'))
      .query({ status: 'PENDING' })
      .set(bearer(admin.accessToken));
    expect(pendingOnly.body.data.map((c: { id: string }) => c.id)).toEqual([pending.id]);

    const approvedOnly = await request(app)
      .get(adminApi('/vet-courses'))
      .query({ status: 'APPROVED' })
      .set(bearer(admin.accessToken));
    expect(approvedOnly.body.data.map((c: { id: string }) => c.id)).toEqual([toApprove.id]);

    const rejectedOnly = await request(app)
      .get(adminApi('/vet-courses'))
      .query({ status: 'REJECTED' })
      .set(bearer(admin.accessToken));
    expect(rejectedOnly.body.data.map((c: { id: string }) => c.id)).toEqual([toReject.id]);

    // No `status` — the admin UI's "All" chip — defaults to PENDING, exactly
    // like `AdminVetServiceListingsScreen`'s own "All" chip. This is what
    // `AdminDashboardService`'s badge count relies on.
    const noFilter = await request(app).get(adminApi('/vet-courses')).set(bearer(admin.accessToken));
    expect(noFilter.body.data.map((c: { id: string }) => c.id)).toEqual([pending.id]);
  });

  it('GET /admin/vet-courses?type=SEMINAR excludes COURSE/WORKSHOP submissions', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const course = await createVetCourse(app, vet.accessToken, { type: 'COURSE', title: 'دورة' });
    const seminar = await createVetCourse(app, vet.accessToken, { type: 'SEMINAR', title: 'ندوة' });

    const seminarsOnly = await request(app)
      .get(adminApi('/vet-courses'))
      .query({ type: 'SEMINAR' })
      .set(bearer(admin.accessToken));
    const ids = seminarsOnly.body.data.map((c: { id: string }) => c.id);
    expect(ids).toEqual([seminar.id]);
    expect(ids).not.toContain(course.id);
  });
});

describe('Seminars — admin create → moderate → publish → register (same lifecycle as courses)', () => {
  it('admin-created Course and Seminar both start PENDING, stay private, and publish only on approval', async () => {
    const admin = await registerAdmin(app);
    const viewer = await registerApprovedVet(app);
    const course = await createVetCourse(app, admin.accessToken, { type: 'COURSE', title: 'دورة الإدارة' });
    const seminar = await createVetCourse(app, admin.accessToken, { type: 'SEMINAR', title: 'ندوة الإدارة' });

    const pending = await request(app)
      .get(adminApi('/vet-courses'))
      .query({ status: 'PENDING', type: 'SEMINAR' })
      .set(bearer(admin.accessToken));
    expect(pending.body.data.map((c: { id: string }) => c.id)).toEqual([seminar.id]);
    expect(pending.body.data[0].status).toBe('PENDING');

    const detail = await request(app).get(adminApi(`/vet-courses/${seminar.id}`)).set(bearer(admin.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.type).toBe('SEMINAR');

    expect((await request(app).get(api('')).set(bearer(viewer.accessToken))).body.data).toHaveLength(0);
    expect((await request(app).get(api(`/${seminar.id}`)).set(bearer(viewer.accessToken))).status).toBe(404);

    expect((await approveVetCourse(app, admin.accessToken, course.id)).status).toBe(200);
    expect((await approveVetCourse(app, admin.accessToken, seminar.id)).status).toBe(200);

    const seminarsOnly = await request(app)
      .get(api(''))
      .query({ type: 'SEMINAR' })
      .set(bearer(viewer.accessToken));
    expect(seminarsOnly.body.data.map((c: { id: string }) => c.id)).toEqual([seminar.id]);
    const all = await request(app).get(api('')).set(bearer(viewer.accessToken));
    expect(all.body.data).toHaveLength(2);
  });

  it('a rejected Seminar never appears publicly and cannot accept registrations', async () => {
    const admin = await registerAdmin(app);
    const seminar = await createVetCourse(app, admin.accessToken, { type: 'SEMINAR', capacity: 10 });
    const reject = await request(app)
      .post(adminApi(`/vet-courses/${seminar.id}/reject`))
      .set(bearer(admin.accessToken))
      .send({ reason: 'غير مكتمل' });
    expect(reject.body.data.status).toBe('REJECTED');

    const vet = await registerApprovedVet(app);
    expect((await request(app).get(api('')).set(bearer(vet.accessToken))).body.data).toHaveLength(0);
    expect((await request(app).get(api(`/${seminar.id}`)).set(bearer(vet.accessToken))).status).toBe(404);
    const res = await registerForVetCourse(app, vet.accessToken, seminar.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VET_COURSE_NOT_OPEN');
  });

  it('a cancelled Seminar rejects registrations', async () => {
    const admin = await registerAdmin(app);
    const seminar = await createVetCourse(app, admin.accessToken, { type: 'SEMINAR', capacity: 10 });
    await approveVetCourse(app, admin.accessToken, seminar.id);
    await request(app).post(adminApi(`/vet-courses/${seminar.id}/cancel`)).set(bearer(admin.accessToken));

    const vet = await registerApprovedVet(app);
    const res = await registerForVetCourse(app, vet.accessToken, seminar.id);
    expect(res.status).toBe(409);
  });

  it('seat counts and the viewer registration state are exact: OPEN → REGISTERED, others see FULL at capacity', async () => {
    const admin = await registerAdmin(app);
    const seminar = await createVetCourse(app, admin.accessToken, { type: 'SEMINAR', capacity: 2 });
    await approveVetCourse(app, admin.accessToken, seminar.id);
    const [a, b, c] = [await registerApprovedVet(app), await registerApprovedVet(app), await registerApprovedVet(app)];

    const before = await request(app).get(api(`/${seminar.id}`)).set(bearer(a.accessToken));
    expect(before.body.data).toMatchObject({
      capacity: 2,
      registrationCount: 0,
      remainingSeats: 2,
      isRegistered: false,
      registrationState: 'OPEN',
    });

    expect((await registerForVetCourse(app, a.accessToken, seminar.id)).status).toBe(201);
    const asA = await request(app).get(api(`/${seminar.id}`)).set(bearer(a.accessToken));
    expect(asA.body.data).toMatchObject({ registrationCount: 1, remainingSeats: 1, isRegistered: true, registrationState: 'REGISTERED' });

    const dup = await registerForVetCourse(app, a.accessToken, seminar.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('VET_COURSE_ALREADY_REGISTERED');

    expect((await registerForVetCourse(app, b.accessToken, seminar.id)).status).toBe(201);

    // The browse list carries the same caller-relative state as the details endpoint.
    const listAsC = await request(app).get(api('')).set(bearer(c.accessToken));
    expect(listAsC.body.data[0]).toMatchObject({ registrationCount: 2, remainingSeats: 0, registrationState: 'FULL' });
    const listAsB = await request(app).get(api('')).set(bearer(b.accessToken));
    expect(listAsB.body.data[0].registrationState).toBe('REGISTERED');

    const full = await registerForVetCourse(app, c.accessToken, seminar.id);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('VET_COURSE_CAPACITY_FULL');

    const adminView = await request(app).get(adminApi(`/vet-courses/${seminar.id}`)).set(bearer(admin.accessToken));
    expect(adminView.body.data).toMatchObject({ capacity: 2, registrationCount: 2, remainingSeats: 0 });
  });

  it('the last seat can only be taken once under concurrent registrations', async () => {
    const admin = await registerAdmin(app);
    const seminar = await createVetCourse(app, admin.accessToken, { type: 'SEMINAR', capacity: 1 });
    await approveVetCourse(app, admin.accessToken, seminar.id);
    const vets = await Promise.all(Array.from({ length: 6 }, () => registerApprovedVet(app)));

    const results = await Promise.all(vets.map((v) => registerForVetCourse(app, v.accessToken, seminar.id)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('VET_COURSE_CAPACITY_FULL');
    }

    const regs = await request(app)
      .get(adminApi(`/vet-courses/${seminar.id}/registrations`))
      .set(bearer(admin.accessToken));
    expect(regs.body.data).toHaveLength(1);
    expect(regs.body.meta.total).toBe(1);
  });

  it('concurrent duplicate registrations by the same user produce exactly one registration', async () => {
    const admin = await registerAdmin(app);
    const seminar = await createVetCourse(app, admin.accessToken, { type: 'SEMINAR', capacity: 10 });
    await approveVetCourse(app, admin.accessToken, seminar.id);
    const vet = await registerApprovedVet(app);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => registerForVetCourse(app, vet.accessToken, seminar.id)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);

    const seats = await request(app).get(api(`/${seminar.id}`)).set(bearer(vet.accessToken));
    expect(seats.body.data).toMatchObject({ registrationCount: 1, remainingSeats: 9 });
  });

  it('admin can view Seminar registrations; a VET_COURSES supervisor who created a Seminar cannot review it themselves', async () => {
    const admin = await registerAdmin(app);
    const supVet = await registerApprovedVet(app);
    await assignSystemSupervisor(app, admin.accessToken, supVet.id, 'VET_COURSES');

    const own = await createVetCourse(app, supVet.accessToken, { type: 'SEMINAR', capacity: 5 });
    expect((await approveVetCourse(app, supVet.accessToken, own.id)).status).toBe(403);
    const ownReject = await request(app)
      .post(adminApi(`/vet-courses/${own.id}/reject`))
      .set(bearer(supVet.accessToken))
      .send({ reason: 'x' });
    expect(ownReject.status).toBe(403);

    // A different moderator (here the admin) can.
    expect((await approveVetCourse(app, admin.accessToken, own.id)).status).toBe(200);

    const registrant = await registerApprovedVet(app);
    await registerForVetCourse(app, registrant.accessToken, own.id);
    const regs = await request(app)
      .get(adminApi(`/vet-courses/${own.id}/registrations`))
      .set(bearer(admin.accessToken));
    expect(regs.status).toBe(200);
    expect(regs.body.data[0].registrant.id).toBe(registrant.id);

    // Unauthorized users cannot moderate or view registrations.
    const plain = await registerUser(app);
    expect((await approveVetCourse(app, plain.accessToken, own.id)).status).toBe(403);
    expect(
      (await request(app).get(adminApi(`/vet-courses/${own.id}/registrations`)).set(bearer(plain.accessToken))).status,
    ).toBe(403);
    expect((await request(app).get(adminApi('/vet-courses')).set(bearer(plain.accessToken))).status).toBe(403);
  });
});

describe('ManagementScreen — separate Courses / Seminars badge counts', () => {
  const summary = async (token: string) =>
    (await request(app).get('/api/v1/admin/dashboard/summary').set(bearer(token))).body.data.cards as {
      id: string;
      count: number;
      activeCount: number;
    }[];
  const card = (cards: { id: string; count: number; activeCount: number }[], id: string) =>
    cards.find((c) => c.id === id);

  it('counts pending Seminars on the seminars card only, and opening Seminars does not clear the Courses badge', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    await createVetCourse(app, vet.accessToken, { type: 'COURSE' });
    await createVetCourse(app, vet.accessToken, { type: 'SEMINAR' });
    const toApprove = await createVetCourse(app, vet.accessToken, { type: 'SEMINAR' });

    let cards = await summary(admin.accessToken);
    expect(card(cards, 'courses')?.count).toBe(1);
    expect(card(cards, 'seminars')?.count).toBe(2);

    await approveVetCourse(app, admin.accessToken, toApprove.id);
    cards = await summary(admin.accessToken);
    expect(card(cards, 'seminars')).toMatchObject({ count: 1, activeCount: 1 });
    expect(card(cards, 'courses')?.activeCount).toBe(0);

    const seen = await request(app)
      .post('/api/v1/admin/dashboard/cards/seminars/seen')
      .set(bearer(admin.accessToken));
    expect(seen.status).toBe(200);

    cards = await summary(admin.accessToken);
    expect(card(cards, 'seminars')?.count).toBe(0);
    expect(card(cards, 'courses')?.count).toBe(1);
  });
});
