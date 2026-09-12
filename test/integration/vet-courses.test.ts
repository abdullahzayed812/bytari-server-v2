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
});
