import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  adminSendNotification,
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  createSyndicate,
  listNotifications,
  markNotificationRead,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  sendChatMessage,
  startConversation,
  unreadCount,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

type Row = { id: string; type: string; source: Record<string, unknown> };
async function inbox(token: string): Promise<Row[]> {
  const res = await listNotifications(app, token);
  expect(res.status).toBe(200);
  return res.body.data as Row[];
}

describe('notifications — source ("From:")', () => {
  it('an admin broadcast is from the administration, whatever type was picked', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    for (const type of ['ADMIN_ANNOUNCEMENT', 'CONTENT_PUBLISHED']) {
      const res = await adminSendNotification(app, admin.accessToken, {
        target: { kind: 'USER', userId: user.id },
        type,
        title: 'تنبيه',
        body: 'نص التنبيه',
      });
      expect(res.status).toBe(201);
    }
    const rows = await inbox(user.accessToken);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.source).toEqual({ kind: 'ADMIN' });
  });

  it('a syndicate announcement is from that syndicate, by name — even when posted by an admin', async () => {
    const admin = await registerAdmin(app);
    const syndicate = await createSyndicate(app, admin.accessToken, { name: 'نقابة البصرة' });
    const officer = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, admin.accessToken, syndicate.id, {
      userId: officer.id,
      permissions: ['syndicate.announcement.manage'],
    });
    const follower = await registerUser(app);
    await request(app)
      .post(`/api/v1/organizations/${syndicate.id}/follow`)
      .set(bearer(follower.accessToken))
      .expect(200);

    for (const token of [officer.accessToken, admin.accessToken]) {
      const res = await request(app)
        .post(`/api/v1/syndicates/${syndicate.id}/announcements`)
        .set(bearer(token))
        .send({ type: 'ANNOUNCEMENT', title: 'اجتماع', body: 'تفاصيل الاجتماع' });
      expect(res.status).toBe(201);
    }
    await tick();

    const rows = (await inbox(follower.accessToken)).filter(
      (r) => r.type === 'SYNDICATE_ANNOUNCEMENT_PUBLISHED',
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.source).toEqual({
        kind: 'ORGANIZATION',
        organizationId: syndicate.id,
        organizationType: 'SYNDICATE',
        name: 'نقابة البصرة',
      });
    }
  });

  it('an approval about my own organization is from the administration, not my org', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة النور',
    });
    await tick();
    const approved = (await inbox(owner.accessToken)).find(
      (r) => r.type === 'ORGANIZATION_APPROVED',
    );
    expect(approved?.source).toEqual({ kind: 'ADMIN' });
  });

  it("a pet owner's message to a clinic is from the pet owner (display name only)", async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Chat Clinic',
    });
    const petOwner = await registerUser(app, { firstName: 'Rana', lastName: 'Khalid' });
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    await getTestDb()('notifications').del();
    await sendChatMessage(app, petOwner.accessToken, conv.id, 'hello clinic');
    await tick();

    const msg = (await inbox(vetOwner.accessToken)).find((r) => r.type === 'CHAT_MESSAGE_RECEIVED');
    expect(msg?.source).toEqual({ kind: 'USER', userId: petOwner.id, name: 'Rana Khalid' });
    expect(JSON.stringify(msg?.source)).not.toContain(petOwner.email);
  });

  it('get / mark-read carry the source; marking read persists and drops the unread count; no IDOR', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    await adminSendNotification(app, admin.accessToken, {
      target: { kind: 'USER', userId: user.id },
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'صيانة',
      body: 'سيتوقف النظام الليلة',
    });
    const [row] = await inbox(user.accessToken);
    expect((await unreadCount(app, user.accessToken)).body.data.count).toBe(1);

    const one = await request(app)
      .get(`/api/v1/notifications/${row?.id}`)
      .set(bearer(user.accessToken));
    expect(one.body.data.source).toEqual({ kind: 'ADMIN' });

    const intruder = await registerUser(app);
    expect((await markNotificationRead(app, intruder.accessToken, row?.id as string)).status).toBe(
      404,
    );
    expect((await unreadCount(app, user.accessToken)).body.data.count).toBe(1);

    const read = await markNotificationRead(app, user.accessToken, row?.id as string);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ read: true, source: { kind: 'ADMIN' } });
    expect((await unreadCount(app, user.accessToken)).body.data.count).toBe(0);
    const stored = await getTestDb()('notifications').where({ id: row?.id }).first('read_at');
    expect(stored.read_at).not.toBeNull();
  });
});
