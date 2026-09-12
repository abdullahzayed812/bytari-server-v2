import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createSyndicate,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  assignOrganizationSupervisor,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/syndicates${p}`;
const adminApi = (p: string): string => `/api/v1/admin${p}`;

describe('Veterinary Syndicates — creation (ADMIN only)', () => {
  it('a plain user cannot create a syndicate; an admin can, and it is publicly readable', async () => {
    const plainUser = await registerUser(app);
    const denied = await request(app)
      .post(adminApi('/syndicates'))
      .set(bearer(plainUser.accessToken))
      .send({ name: 'نقابة تجريبية' });
    expect(denied.status).toBe(403);

    const admin = await registerAdmin(app);
    const main = await createSyndicate(app, admin.accessToken, { name: 'نقابة الأطباء البيطريين العراقية' });
    expect(main.id).toBeTruthy();

    const other = await registerUser(app);
    const get = await request(app).get(api(`/${main.id}`)).set(bearer(other.accessToken));
    expect(get.status).toBe(200);
    expect(get.body.data.name).toBe('نقابة الأطباء البيطريين العراقية');
    expect(get.body.data.parentOrganizationId).toBeNull();

    const list = await request(app).get(api('')).set(bearer(other.accessToken));
    expect(list.body.data).toHaveLength(1);
  });

  it('a subordinate syndicate requires a valid main-syndicate parent', async () => {
    const admin = await registerAdmin(app);
    const main = await createSyndicate(app, admin.accessToken);

    const notFound = await request(app)
      .post(adminApi('/syndicates'))
      .set(bearer(admin.accessToken))
      .send({ parentOrganizationId: '00000000-0000-0000-0000-000000000000', name: 'فرع بغداد' });
    expect(notFound.status).toBe(404);

    const branch = await createSyndicate(app, admin.accessToken, {
      parentOrganizationId: main.id,
      name: 'فرع النقابة - بغداد',
      governorate: 'بغداد',
    });
    expect(branch.id).toBeTruthy();

    // A branch cannot itself be a parent (max one level of nesting).
    const tooDeep = await request(app)
      .post(adminApi('/syndicates'))
      .set(bearer(admin.accessToken))
      .send({ parentOrganizationId: branch.id, name: 'فرع فرعي' });
    expect(tooDeep.status).toBe(403);

    const branches = await request(app)
      .get(api(`/${main.id}/branches`))
      .set(bearer(admin.accessToken));
    expect(branches.body.data).toHaveLength(1);
    expect(branches.body.data[0].id).toBe(branch.id);
  });
});

describe('Veterinary Syndicates — per-syndicate scoped supervisors', () => {
  async function setup() {
    const admin = await registerAdmin(app);
    const mainA = await createSyndicate(app, admin.accessToken, { name: 'نقابة أ' });
    const mainB = await createSyndicate(app, admin.accessToken, { name: 'نقابة ب' });
    const supervisor = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, admin.accessToken, mainA.id, {
      userId: supervisor.id,
      permissions: ['syndicate.announcement.manage', 'syndicate.submission.read', 'syndicate.submission.respond'],
    });
    return { admin, mainA, mainB, supervisor };
  }

  it('a supervisor can manage announcements only for their assigned syndicate', async () => {
    const { mainA, mainB, supervisor } = await setup();

    const okCreate = await request(app)
      .post(api(`/${mainA.id}/announcements`))
      .set(bearer(supervisor.accessToken))
      .send({ type: 'ANNOUNCEMENT', title: 'اجتماع الهيئة العامة', body: 'تفاصيل الاجتماع' });
    expect(okCreate.status).toBe(201);

    const denied = await request(app)
      .post(api(`/${mainB.id}/announcements`))
      .set(bearer(supervisor.accessToken))
      .send({ type: 'ANNOUNCEMENT', title: 'إعلان آخر', body: 'نص الإعلان' });
    expect(denied.status).toBe(403);

    const publicList = await request(app).get(api(`/${mainA.id}/announcements`)).set(bearer(supervisor.accessToken));
    expect(publicList.body.data).toHaveLength(1);
  });

  it('a supervisor can respond to / close submissions only for their assigned syndicate', async () => {
    const { mainA, mainB, supervisor } = await setup();
    const submitter = await registerUser(app);

    const inquiry = await request(app)
      .post(api(`/${mainA.id}/submissions`))
      .set(bearer(submitter.accessToken))
      .send({ kind: 'INQUIRY', message: 'ما هي متطلبات تجديد الهوية؟' });
    expect(inquiry.status).toBe(201);
    expect(inquiry.body.data.status).toBe('PENDING');

    const inquiryOnB = await request(app)
      .post(api(`/${mainB.id}/submissions`))
      .set(bearer(submitter.accessToken))
      .send({ kind: 'INQUIRY', message: 'سؤال آخر' });

    const deniedRead = await request(app)
      .get(api(`/${mainB.id}/submissions`))
      .set(bearer(supervisor.accessToken));
    expect(deniedRead.status).toBe(403);
    void inquiryOnB;

    const respond = await request(app)
      .post(api(`/${mainA.id}/submissions/${inquiry.body.data.id}/respond`))
      .set(bearer(supervisor.accessToken))
      .send({ responseText: 'يمكنكم مراجعة قسم إصدار/تجديد الهوية.' });
    expect(respond.status).toBe(200);
    expect(respond.body.data.status).toBe('RESPONDED');

    const respondAgain = await request(app)
      .post(api(`/${mainA.id}/submissions/${inquiry.body.data.id}/respond`))
      .set(bearer(supervisor.accessToken))
      .send({ responseText: 'مرة أخرى' });
    expect(respondAgain.status).toBe(409);

    const close = await request(app)
      .post(api(`/${mainA.id}/submissions/${inquiry.body.data.id}/close`))
      .set(bearer(supervisor.accessToken));
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('CLOSED');

    const closeAgain = await request(app)
      .post(api(`/${mainA.id}/submissions/${inquiry.body.data.id}/close`))
      .set(bearer(supervisor.accessToken));
    expect(closeAgain.status).toBe(409);
  });
});

describe('Veterinary Syndicates — requests & inquiries (submitter-facing)', () => {
  it('a request requires a requestType; an inquiry does not', async () => {
    const admin = await registerAdmin(app);
    const main = await createSyndicate(app, admin.accessToken);
    const user = await registerUser(app);

    const missingType = await request(app)
      .post(api(`/${main.id}/submissions`))
      .set(bearer(user.accessToken))
      .send({ kind: 'REQUEST', message: 'أرغب بإصدار هوية جديدة' });
    expect(missingType.status).toBe(422);

    const okRequest = await request(app)
      .post(api(`/${main.id}/submissions`))
      .set(bearer(user.accessToken))
      .send({ kind: 'REQUEST', requestType: 'ID_ISSUANCE', message: 'أرغب بإصدار هوية جديدة' });
    expect(okRequest.status).toBe(201);
  });

  it("submissions are private to the submitter and the syndicate's authorized supervisors", async () => {
    const admin = await registerAdmin(app);
    const main = await createSyndicate(app, admin.accessToken);
    const submitter = await registerUser(app);
    const stranger = await registerUser(app);

    const created = await request(app)
      .post(api(`/${main.id}/submissions`))
      .set(bearer(submitter.accessToken))
      .send({ kind: 'INQUIRY', message: 'استفسار' });

    const strangerGet = await request(app)
      .get(api(`/submissions/mine/${created.body.data.id}`))
      .set(bearer(stranger.accessToken));
    expect(strangerGet.status).toBe(404);

    const mine = await request(app).get(api('/submissions/mine')).set(bearer(submitter.accessToken));
    expect(mine.body.data).toHaveLength(1);

    // Admin (org-owner override) can read it directly.
    const asAdmin = await request(app)
      .get(api(`/${main.id}/submissions/${created.body.data.id}`))
      .set(bearer(admin.accessToken));
    expect(asAdmin.status).toBe(200);
  });
});

describe('Veterinary Syndicates — following (reuses the generic organization follow feature)', () => {
  it('following a syndicate is reflected on its public profile', async () => {
    const admin = await registerAdmin(app);
    const main = await createSyndicate(app, admin.accessToken);
    const user = await registerUser(app);

    const before = await request(app).get(api(`/${main.id}`)).set(bearer(user.accessToken));
    expect(before.body.data.isFollowing).toBe(false);

    const follow = await request(app)
      .post(`/api/v1/organizations/${main.id}/follow`)
      .set(bearer(user.accessToken));
    expect(follow.status).toBe(200);

    const after = await request(app).get(api(`/${main.id}`)).set(bearer(user.accessToken));
    expect(after.body.data.isFollowing).toBe(true);
    expect(after.body.data.followersCount).toBe(1);
  });
});

describe('Veterinary Syndicates — my-access ("what can I do here?")', () => {
  it("reflects ADMIN, the syndicate's OWNER, an assigned supervisor, and a plain user distinctly", async () => {
    const admin = await registerAdmin(app);
    const main = await createSyndicate(app, admin.accessToken);
    const supervisor = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, admin.accessToken, main.id, {
      userId: supervisor.id,
      permissions: ['syndicate.submission.read'],
    });
    const plainUser = await registerUser(app);

    const asAdmin = await request(app).get(api(`/${main.id}/my-access`)).set(bearer(admin.accessToken));
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data).toMatchObject({
      isAdmin: true,
      canManageAnnouncements: true,
      canReadSubmissions: true,
      canRespondSubmissions: true,
    });

    const asSupervisor = await request(app)
      .get(api(`/${main.id}/my-access`))
      .set(bearer(supervisor.accessToken));
    expect(asSupervisor.body.data).toMatchObject({
      isAdmin: false,
      isOwner: false,
      canReadSubmissions: true,
      canManageAnnouncements: false,
      canRespondSubmissions: false,
    });

    const asPlainUser = await request(app)
      .get(api(`/${main.id}/my-access`))
      .set(bearer(plainUser.accessToken));
    expect(asPlainUser.body.data).toMatchObject({
      isAdmin: false,
      isOwner: false,
      canManageProfile: false,
      canManageAnnouncements: false,
      canReadSubmissions: false,
      canRespondSubmissions: false,
    });
  });
});
