import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createSyndicate,
  listNotifications,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/syndicates${p}`;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

type User = Awaited<ReturnType<typeof registerUser>>;

/** Admin creates a syndicate and assigns a plain (non-vet, non-admin) account as its syndicate admin. */
async function syndicateWithAdmin(): Promise<{
  admin: User;
  syndicateAdmin: User;
  syndicateId: string;
}> {
  const admin = await registerAdmin(app);
  const syndicate = await createSyndicate(app, admin.accessToken, { name: 'نقابة البيطريين' });
  const syndicateAdmin = await registerUser(app);
  const res = await request(app)
    .post(api(`/${syndicate.id}/admins`))
    .set(bearer(admin.accessToken))
    .send({ email: syndicateAdmin.email });
  expect(res.status).toBe(201);
  return { admin, syndicateAdmin, syndicateId: syndicate.id };
}

async function registerMember(syndicateId: string): Promise<User> {
  const member = await registerUser(app);
  const res = await request(app)
    .post(api(`/${syndicateId}/registration`))
    .set(bearer(member.accessToken));
  expect(res.status).toBe(201);
  return member;
}

describe('syndicate admin — full syndicate-scoped permissions', () => {
  it('an assigned syndicate admin (a normal account) can manage the syndicate but gains no global admin rights', async () => {
    const { syndicateAdmin, syndicateId } = await syndicateWithAdmin();
    const t = bearer(syndicateAdmin.accessToken);

    const access = await request(app)
      .get(api(`/${syndicateId}/my-access`))
      .set(t);
    expect(access.body.data).toMatchObject({
      isAdmin: false,
      canManageProfile: true,
      canManageAnnouncements: true,
      canReadSubmissions: true,
      canRespondSubmissions: true,
      canReadMembers: true,
      canManageMembers: true,
      canMessageMembers: true,
      canDelete: false,
    });

    const announce = await request(app)
      .post(api(`/${syndicateId}/announcements`))
      .set(t)
      .send({ type: 'ANNOUNCEMENT', title: 'اجتماع عام', body: 'يعقد الاجتماع العام يوم الخميس' });
    expect(announce.status).toBe(201);

    const edit = await request(app)
      .patch(api(`/${syndicateId}/profile`))
      .set(t)
      .send({ name: 'نقابة البيطريين المحدثة', phone: '0770000000' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.name).toBe('نقابة البيطريين المحدثة');

    const members = await request(app)
      .get(api(`/${syndicateId}/members`))
      .set(t);
    expect(members.status).toBe(200);

    // Not a global admin: cannot create or delete syndicates, nor reach /admin lists.
    const create = await request(app).post('/api/v1/admin/syndicates').set(t).send({ name: 'x x' });
    expect(create.status).toBe(403);
    const del = await request(app).delete(`/api/v1/admin/syndicates/${syndicateId}`).set(t);
    expect(del.status).toBe(403);
  });

  it('a syndicate admin of one syndicate has no rights on another syndicate', async () => {
    const { admin, syndicateAdmin } = await syndicateWithAdmin();
    const other = await createSyndicate(app, admin.accessToken, { name: 'نقابة أخرى' });
    const t = bearer(syndicateAdmin.accessToken);
    expect(
      (
        await request(app)
          .get(api(`/${other.id}/members`))
          .set(t)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(api(`/${other.id}/announcements`))
          .set(t)
          .send({ type: 'ANNOUNCEMENT', title: 'عنوان', body: 'نص الإعلان' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(api(`/${other.id}/members/broadcast`))
          .set(t)
          .send({ title: 'x', body: 'y', clientRequestId: randomUUID() })
      ).status,
    ).toBe(403);
  });
});

describe('syndicate registration + members', () => {
  it('a user registers; the syndicate admin lists and opens the member (basic info only)', async () => {
    const { syndicateAdmin, syndicateId } = await syndicateWithAdmin();
    const member = await registerMember(syndicateId);

    const again = await request(app)
      .post(api(`/${syndicateId}/registration`))
      .set(bearer(member.accessToken));
    expect(again.status).toBe(409);

    const mine = await request(app)
      .get(api(`/${syndicateId}`))
      .set(bearer(member.accessToken));
    expect(mine.body.data.isRegistered).toBe(true);
    expect(mine.body.data.membersCount).toBe(1);
    expect(mine.body.data.counters).toBeNull();

    const list = await request(app)
      .get(api(`/${syndicateId}/members`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].userId).toBe(member.id);

    const one = await request(app)
      .get(api(`/${syndicateId}/members/${member.id}`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(one.status).toBe(200);
    expect(one.body.data.email).toBe(member.email);
    expect(one.body.data).not.toHaveProperty('passwordHash');
    expect(one.body.data).not.toHaveProperty('avatarKey');

    // A plain member cannot list other members.
    const denied = await request(app)
      .get(api(`/${syndicateId}/members`))
      .set(bearer(member.accessToken));
    expect(denied.status).toBe(403);

    // The member cancels; they disappear from the list.
    const cancel = await request(app)
      .delete(api(`/${syndicateId}/registration`))
      .set(bearer(member.accessToken));
    expect(cancel.status).toBe(204);
    const after = await request(app)
      .get(api(`/${syndicateId}/members`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(after.body.data).toHaveLength(0);
  });

  it('the syndicate admin messages a member through the existing chat; both sides can read it', async () => {
    const { syndicateAdmin, syndicateId } = await syndicateWithAdmin();
    const member = await registerMember(syndicateId);
    const stranger = await registerUser(app);

    const open = await request(app)
      .post(api(`/${syndicateId}/members/${member.id}/conversation`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(open.status).toBe(201);
    const conversationId = open.body.data.id as string;
    expect(open.body.data.type).toBe('SYNDICATE_MEMBER');

    const reopen = await request(app)
      .post(api(`/${syndicateId}/members/${member.id}/conversation`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.id).toBe(conversationId);

    const send = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(bearer(syndicateAdmin.accessToken))
      .send({ body: 'مرحباً بك في النقابة' });
    expect(send.status).toBe(201);

    const reply = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set(bearer(member.accessToken))
      .send({ body: 'شكراً' });
    expect(reply.status).toBe(201);

    const leak = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set(bearer(stranger.accessToken));
    expect(leak.status).toBe(404);

    // Cannot open a chat with someone who is not a registered member.
    const notMember = await request(app)
      .post(api(`/${syndicateId}/members/${stranger.id}/conversation`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(notMember.status).toBe(404);
  });

  it('"message all members" notifies only this syndicate’s members, once per request id', async () => {
    const { admin, syndicateAdmin, syndicateId } = await syndicateWithAdmin();
    const memberA = await registerMember(syndicateId);
    const other = await createSyndicate(app, admin.accessToken, { name: 'نقابة ثانية' });
    const otherMember = await registerMember(other.id);

    const clientRequestId = randomUUID();
    const body = { title: 'تنبيه', body: 'موعد تجديد الهويات', clientRequestId };
    const first = await request(app)
      .post(api(`/${syndicateId}/members/broadcast`))
      .set(bearer(syndicateAdmin.accessToken))
      .send(body);
    expect(first.status).toBe(202);
    expect(first.body.data.recipientCount).toBe(1);
    const dup = await request(app)
      .post(api(`/${syndicateId}/members/broadcast`))
      .set(bearer(syndicateAdmin.accessToken))
      .send(body);
    expect(dup.status).toBe(202);
    await tick();

    const aNotifs = await listNotifications(app, memberA.accessToken);
    const broadcasts = (aNotifs.body.data as Array<{ type: string }>).filter(
      (n) => n.type === 'ORGANIZATION_BROADCAST',
    );
    expect(broadcasts).toHaveLength(1);
    const otherNotifs = await listNotifications(app, otherMember.accessToken);
    expect(
      (otherNotifs.body.data as Array<{ type: string }>).filter(
        (n) => n.type === 'ORGANIZATION_BROADCAST',
      ),
    ).toHaveLength(0);
  });

  it('request / inquiry counters are per-officer and drop when the officer opens the submission', async () => {
    const { syndicateAdmin, syndicateId } = await syndicateWithAdmin();
    const member = await registerMember(syndicateId);
    const inquiry = await request(app)
      .post(api(`/${syndicateId}/submissions`))
      .set(bearer(member.accessToken))
      .send({ kind: 'INQUIRY', message: 'متى يفتح باب التجديد؟' });
    expect(inquiry.status).toBe(201);
    await request(app)
      .post(api(`/${syndicateId}/submissions`))
      .set(bearer(member.accessToken))
      .send({ kind: 'REQUEST', requestType: 'ID_RENEWAL', message: 'تجديد الهوية' });
    await tick();

    const before = await request(app)
      .get(api(`/${syndicateId}`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(before.body.data.counters).toEqual({
      unreadRequests: 1,
      unreadInquiries: 1,
      pendingRequests: 1,
      pendingInquiries: 1,
    });

    const open = await request(app)
      .get(api(`/${syndicateId}/submissions/${inquiry.body.data.id}`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(open.status).toBe(200);

    const after = await request(app)
      .get(api(`/${syndicateId}`))
      .set(bearer(syndicateAdmin.accessToken));
    expect(after.body.data.counters.unreadInquiries).toBe(0);
    expect(after.body.data.counters.unreadRequests).toBe(1);
  });

  it('an officer of another syndicate cannot read a submission by id through their own syndicate', async () => {
    const { admin, syndicateId } = await syndicateWithAdmin();
    const other = await createSyndicate(app, admin.accessToken, { name: 'نقابة ثالثة' });
    const otherAdmin = await registerUser(app);
    await request(app)
      .post(api(`/${other.id}/admins`))
      .set(bearer(admin.accessToken))
      .send({ email: otherAdmin.email });
    const member = await registerMember(syndicateId);
    const inquiry = await request(app)
      .post(api(`/${syndicateId}/submissions`))
      .set(bearer(member.accessToken))
      .send({ kind: 'INQUIRY', message: 'سؤال خاص' });

    const idor = await request(app)
      .get(api(`/${other.id}/submissions/${inquiry.body.data.id}`))
      .set(bearer(otherAdmin.accessToken));
    expect(idor.status).toBe(404);
  });
});

describe('delete syndicate (soft, global Admin only)', () => {
  it('deactivates the syndicate, ends registrations and hides it from browse', async () => {
    const { admin, syndicateId } = await syndicateWithAdmin();
    const member = await registerMember(syndicateId);

    const del = await request(app)
      .delete(`/api/v1/admin/syndicates/${syndicateId}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(204);

    const get = await request(app)
      .get(api(`/${syndicateId}`))
      .set(bearer(member.accessToken));
    expect(get.status).toBe(404);
    const list = await request(app).get(api('')).set(bearer(member.accessToken));
    expect(list.body.data).toHaveLength(0);
    const reg = await request(app)
      .get(api(`/${syndicateId}/registration`))
      .set(bearer(member.accessToken));
    expect(reg.body.data).toBeNull();
  });

  it('refuses to delete a main syndicate that still has an active branch', async () => {
    const admin = await registerAdmin(app);
    const main = await createSyndicate(app, admin.accessToken, { name: 'الرئيسية' });
    await createSyndicate(app, admin.accessToken, { name: 'فرع', parentOrganizationId: main.id });
    const del = await request(app)
      .delete(`/api/v1/admin/syndicates/${main.id}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(409);
  });
});
