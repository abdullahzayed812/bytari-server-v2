import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { FakePushProvider } from '../helpers/fake-push-provider.js';
import {
  addOrganizationMember,
  adminSendNotification,
  archiveContent,
  bearer,
  closeThread,
  createActiveOrganization,
  createConsultation,
  createContent,
  listDevices,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  publishContent,
  registerAdmin,
  registerApprovedVet,
  registerDevice,
  registerSupportSupervisor,
  registerUser,
  removeDevice,
  sendChatMessage,
  sendThreadMessage,
  setPushPreference,
  startConversation,
  unreadCount,
} from '../helpers/factories.js';

const push = new FakePushProvider();
const { app, container } = buildTestApp({ pushProvider: push });

const events: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('notification.')) events.push(e.name);
});
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  push.reset();
  events.length = 0;
});
afterAll(() => closeTestDb());

async function notifRows(
  userId: string,
): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  return getTestDb()('notifications')
    .where({ recipient_user_id: userId })
    .orderBy('created_at', 'asc')
    .select('type', 'data');
}

const TOKEN_A = 'fcm-token-aaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'fcm-token-bbbbbbbbbbbbbbbbbbbb';
const TOKEN_C = 'fcm-token-cccccccccccccccccccc';

// --- device tokens --------------------------------------------------

describe('notifications — device tokens', () => {
  it('registers a device; the raw token is never returned', async () => {
    const u = await registerUser(app);
    const res = await registerDevice(app, u.accessToken, { token: TOKEN_A, platform: 'android' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ platform: 'android', revoked: false });
    expect(res.body.data).not.toHaveProperty('token');
    expect(res.body.data.tokenSuffix).toBe(`…${TOKEN_A.slice(-6)}`);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN_A);
  });

  it('re-registering the same token updates in place (no duplicate row)', async () => {
    const u = await registerUser(app);
    await registerDevice(app, u.accessToken, { token: TOKEN_A, platform: 'android' });
    await registerDevice(app, u.accessToken, {
      token: TOKEN_A,
      platform: 'ios',
      appVersion: '2.0',
    });
    const list = await listDevices(app, u.accessToken);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ platform: 'ios', appVersion: '2.0' });
    const count = await getTestDb()('device_push_tokens').where({ user_id: u.id }).count();
    expect(Number((count[0] as { count: string }).count)).toBe(1);
  });

  it("a user cannot remove another user's device (404, not 403 — no id leak)", async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const reg = await registerDevice(app, a.accessToken, { token: TOKEN_A, platform: 'web' });
    const deviceId = reg.body.data.id as string;
    expect((await removeDevice(app, b.accessToken, deviceId)).status).toBe(404);
    expect((await removeDevice(app, a.accessToken, deviceId)).status).toBe(204);
    expect((await removeDevice(app, a.accessToken, deviceId)).status).toBe(404); // gone
  });

  it('device endpoints require authentication', async () => {
    await request(app).get('/api/v1/notifications/devices').expect(401);
    await request(app)
      .post('/api/v1/notifications/devices')
      .send({ token: TOKEN_A, platform: 'web' })
      .expect(401);
  });

  it('rejects a spoofed userId in the body (422 — strict schema)', async () => {
    const u = await registerUser(app);
    const other = await registerUser(app);
    await request(app)
      .post('/api/v1/notifications/devices')
      .set(bearer(u.accessToken))
      .send({ token: TOKEN_A, platform: 'web', userId: other.id })
      .expect(422);
  });
});

// --- event → notification ----------------------------------------

describe('notifications — event handling', () => {
  it('organization.approved creates an in-app notification for the owner + attempts push', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    await registerDevice(app, owner.accessToken, { token: TOKEN_A, platform: 'ios' });
    push.reset();

    await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Notif Clinic',
    });
    await tick();

    const rows = await notifRows(owner.id);
    expect(rows.map((r) => r.type)).toContain('ORGANIZATION_APPROVED');
    expect(events).toContain('notification.created');
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.tokens).toEqual([TOKEN_A]);
    // push payload carries only ids + type
    expect(push.sent[0]?.data).toMatchObject({ type: 'ORGANIZATION_APPROVED' });
  });

  it('organization member added → the added member is notified', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Member Clinic',
    });
    const staff = await registerUser(app);
    await addOrganizationMember(app, owner.accessToken, clinic.id, {
      userId: staff.id,
      role: 'STAFF',
    });
    await tick();
    expect((await notifRows(staff.id)).map((r) => r.type)).toContain('ORGANIZATION_MEMBER_ADDED');
  });

  it('consultation reply from a supervisor notifies the creator — NOT the supervisor', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const sup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const c = await createConsultation(app, owner.accessToken, 'help');
    const id = c.body.data.id as string;
    await tick();
    // creation already notified the supervisor
    expect((await notifRows(sup.id)).map((r) => r.type)).toContain('CONSULTATION_CREATED');

    await getTestDb()('notifications').del();
    await sendThreadMessage(app, sup.accessToken, 'consultations', id, 'reply');
    await tick();

    expect((await notifRows(owner.id)).map((r) => r.type)).toEqual([
      'CONSULTATION_MESSAGE_RECEIVED',
    ]);
    expect(await notifRows(sup.id)).toHaveLength(0); // sender not notified
  });

  it('consultation message from the creator notifies the responsible supervisor, not the creator', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const sup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const c = await createConsultation(app, owner.accessToken, 'first');
    const id = c.body.data.id as string;
    await tick();
    await getTestDb()('notifications').del();

    await sendThreadMessage(app, owner.accessToken, 'consultations', id, 'more info');
    await tick();
    expect((await notifRows(sup.id)).map((r) => r.type)).toEqual(['CONSULTATION_MESSAGE_RECEIVED']);
    expect(await notifRows(owner.id)).toHaveLength(0);
  });

  it('consultation closed notifies the creator', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;
    await getTestDb()('notifications').del();
    await closeThread(app, admin.accessToken, 'consultations', id);
    await tick();
    expect((await notifRows(owner.id)).map((r) => r.type)).toContain('CONSULTATION_CLOSED');
  });

  it('a chat message notifies the recipient, not the sender', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Chat Clinic',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    await getTestDb()('notifications').del();

    await sendChatMessage(app, petOwner.accessToken, conv.id, 'hello clinic');
    await tick();

    // the clinic member (vetOwner) is notified; the pet owner (sender) is not
    expect((await notifRows(vetOwner.id)).map((r) => r.type)).toContain('CHAT_MESSAGE_RECEIVED');
    expect(await notifRows(petOwner.id)).toHaveLength(0);
  });

  it('unsupported events (e.g. content.published) create no notifications', async () => {
    const admin = await registerAdmin(app);
    const id = (await createContent(app, admin.accessToken, { type: 'ARTICLE', title: 'X' })).body
      .data.id as string;
    await publishContent(app, admin.accessToken, id);
    await archiveContent(app, admin.accessToken, id);
    await tick();
    const count = await getTestDb()('notifications').count();
    expect(Number((count[0] as { count: string }).count)).toBe(0);
  });

  it('the same domain event processed twice does not create a duplicate (source_event_key)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;
    await tick();
    await getTestDb()('notifications').del();

    await sendThreadMessage(app, admin.accessToken, 'consultations', id, 'reply');
    await tick();
    // replay the exact same event
    container.eventBus.publish('consultation.message.created', {
      consultationId: id,
      messageId: (
        await getTestDb()('consultation_messages')
          .where({ thread_id: id })
          .orderBy('created_at', 'desc')
          .first()
      ).id,
      source: 'ADMIN',
    });
    await tick();
    expect(await notifRows(owner.id)).toHaveLength(1);
  });
});

// --- Firebase / push behaviour ------------------------------------

describe('notifications — FCM behaviour (fake provider)', () => {
  async function ownerWithDevices(
    tokens: string[],
  ): Promise<{ ownerId: string; ownerToken: string; adminToken: string }> {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    for (const [i, tok] of tokens.entries()) {
      await registerDevice(app, owner.accessToken, {
        token: tok,
        platform: (['ios', 'android', 'web'] as const)[i % 3] ?? 'ios',
      });
    }
    return { ownerId: owner.id, ownerToken: owner.accessToken, adminToken: admin.accessToken };
  }

  it('push is attempted to every active device of the recipient', async () => {
    const { ownerToken, adminToken } = await ownerWithDevices([TOKEN_A, TOKEN_B, TOKEN_C]);
    push.reset();
    await createActiveOrganization(app, ownerToken, adminToken, {
      type: 'CLINIC',
      name: 'FCM Clinic',
    });
    await tick();
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.tokens.sort()).toEqual([TOKEN_A, TOKEN_B, TOKEN_C].sort());
  });

  it('an invalid token reported by FCM is revoked; the notification still succeeds', async () => {
    const { ownerId, ownerToken, adminToken } = await ownerWithDevices([TOKEN_A, TOKEN_B, TOKEN_C]);
    push.reset();
    push.markInvalid(TOKEN_B);

    await createActiveOrganization(app, ownerToken, adminToken, {
      type: 'CLINIC',
      name: 'Invalid Token Clinic',
    });
    await tick();

    expect((await notifRows(ownerId)).map((r) => r.type)).toContain('ORGANIZATION_APPROVED');
    const row = await getTestDb()('device_push_tokens').where({ token: TOKEN_B }).first();
    expect(row.revoked_at).not.toBeNull();
    const surviving = await getTestDb()('device_push_tokens')
      .where({ user_id: ownerId })
      .whereNull('revoked_at')
      .pluck('token');
    expect(surviving.sort()).toEqual([TOKEN_A, TOKEN_C].sort());
  });

  it('a transient FCM failure does not remove the in-app notification', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    await registerDevice(app, owner.accessToken, { token: TOKEN_A, platform: 'ios' });
    push.reset();
    push.failNextWith(new Error('FCM temporarily unavailable'));

    await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Transient Clinic',
    });
    await tick();

    expect((await notifRows(owner.id)).map((r) => r.type)).toContain('ORGANIZATION_APPROVED');
  });

  it('a recipient with pushEnabled=false gets the in-app notification but no push', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    await registerDevice(app, owner.accessToken, { token: TOKEN_A, platform: 'ios' });
    await setPushPreference(app, owner.accessToken, false);
    push.reset();

    await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'No Push Clinic',
    });
    await tick();

    expect((await notifRows(owner.id)).map((r) => r.type)).toContain('ORGANIZATION_APPROVED');
    expect(push.sent).toHaveLength(0);
  });

  it('a recipient with no registered devices → in-app only, no push call', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    push.reset();
    await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Deviceless Clinic',
    });
    await tick();
    expect((await notifRows(owner.id)).length).toBeGreaterThan(0);
    expect(push.sent).toHaveLength(0); // sendToUser short-circuits with 0 tokens
  });
});

// --- inbox: read / list / count --------------------------------

describe('notifications — inbox', () => {
  async function seedThree(): Promise<{ token: string; ids: string[] }> {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    for (let i = 0; i < 3; i += 1) {
      await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type: 'CLINIC',
        name: `Clinic ${i}-${Date.now()}`,
      });
    }
    await tick();
    const list = await listNotifications(app, owner.accessToken);
    return { token: owner.accessToken, ids: list.body.data.map((n: { id: string }) => n.id) };
  }

  it('lists newest-first, paginates, and reports an efficient unread count', async () => {
    const { token } = await seedThree();
    const page1 = await listNotifications(app, token, { pageSize: 2, page: 1 });
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.total).toBe(3);
    const times = page1.body.data.map((n: { createdAt: string }) => n.createdAt);
    expect([...times].sort().reverse()).toEqual(times); // desc

    expect((await unreadCount(app, token)).body.data.count).toBe(3);
  });

  it('mark-read is idempotent and updates the unread count', async () => {
    const { token, ids } = await seedThree();
    const r1 = await markNotificationRead(app, token, ids[0] as string);
    expect(r1.body.data.read).toBe(true);
    expect((await markNotificationRead(app, token, ids[0] as string)).status).toBe(200);
    expect((await unreadCount(app, token)).body.data.count).toBe(2);

    const filtered = await listNotifications(app, token, { read: 'false' });
    expect(filtered.body.data.map((n: { id: string }) => n.id)).not.toContain(ids[0]);
  });

  it('mark-all-read clears everything', async () => {
    const { token } = await seedThree();
    const res = await markAllNotificationsRead(app, token);
    expect(res.body.data.updated).toBe(3);
    expect((await unreadCount(app, token)).body.data.count).toBe(0);
  });

  it("cross-user IDOR: a user cannot read or mark another user's notification", async () => {
    const { ids } = await seedThree();
    const intruder = await registerUser(app);
    expect(
      (await request(app).get(`/api/v1/notifications/${ids[0]}`).set(bearer(intruder.accessToken)))
        .status,
    ).toBe(404);
    expect((await markNotificationRead(app, intruder.accessToken, ids[0] as string)).status).toBe(
      404,
    );
    // and the owner's notification is untouched
  });

  it('notification endpoints require authentication', async () => {
    await request(app).get('/api/v1/notifications').expect(401);
    await request(app).get('/api/v1/notifications/unread-count').expect(401);
  });
});

// --- admin broadcast ------------------------------------------

describe('notifications — admin broadcast', () => {
  it('USER target: creates one notification + push for that user; requires the permission', async () => {
    const admin = await registerAdmin(app);
    const target = await registerApprovedVet(app);
    await registerDevice(app, target.accessToken, { token: TOKEN_A, platform: 'ios' });
    push.reset();

    const res = await adminSendNotification(app, admin.accessToken, {
      target: { kind: 'USER', userId: target.id },
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'Scheduled maintenance',
      body: 'The system will be down tonight.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.recipientCount).toBe(1);
    await tick();
    expect((await notifRows(target.id)).map((r) => r.type)).toEqual(['ADMIN_ANNOUNCEMENT']);
    expect(push.sent).toHaveLength(1);

    // a non-admin cannot broadcast
    const user = await registerUser(app);
    expect(
      (
        await adminSendNotification(app, user.accessToken, {
          target: { kind: 'ALL' },
          type: 'ADMIN_ANNOUNCEMENT',
          title: 't',
          body: 'b',
        })
      ).status,
    ).toBe(403);
  });

  it('ROLE target: notifies every active user of that role', async () => {
    const admin = await registerAdmin(app);
    const v1 = await registerApprovedVet(app);
    const v2 = await registerApprovedVet(app);
    await registerUser(app); // a PET_OWNER, should NOT receive a VETERINARIAN broadcast

    const res = await adminSendNotification(app, admin.accessToken, {
      target: { kind: 'ROLE', roleKey: 'VETERINARIAN' },
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'Vets only',
      body: 'CE credits available.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.recipientCount).toBe(2);
    await tick();
    expect((await notifRows(v1.id)).map((r) => r.type)).toEqual(['ADMIN_ANNOUNCEMENT']);
    expect((await notifRows(v2.id)).map((r) => r.type)).toEqual(['ADMIN_ANNOUNCEMENT']);
  });

  it('ALL target: notifies every active user; validates an unknown USER target', async () => {
    const admin = await registerAdmin(app);
    const u1 = await registerUser(app);
    const res = await adminSendNotification(app, admin.accessToken, {
      target: { kind: 'ALL' },
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'Everyone',
      body: 'Hello all.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.recipientCount).toBeGreaterThanOrEqual(2); // admin + u1
    await tick();
    expect((await notifRows(u1.id)).map((r) => r.type)).toEqual(['ADMIN_ANNOUNCEMENT']);

    const bad = await adminSendNotification(app, admin.accessToken, {
      target: { kind: 'USER', userId: '00000000-0000-0000-0000-000000000000' },
      type: 'ADMIN_ANNOUNCEMENT',
      title: 't',
      body: 'b',
    });
    expect(bad.status).toBe(404);
  });

  it('the admin send is audited with the actor + no message body / tokens', async () => {
    const admin = await registerAdmin(app);
    const target = await registerUser(app);
    await adminSendNotification(app, admin.accessToken, {
      target: { kind: 'USER', userId: target.id },
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'secret maintenance window',
      body: 'confidential body text',
    });
    const rows = await getTestDb()('audit_logs')
      .where({ action: 'ADMIN_NOTIFICATION_SENT' })
      .select('actor_user_id', 'metadata');
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(admin.id);
    expect(JSON.stringify(rows[0])).not.toContain('confidential body text');
    expect(rows[0].metadata).toMatchObject({
      targetKind: 'USER',
      type: 'ADMIN_ANNOUNCEMENT',
      recipientCount: 1,
    });
  });
});

// --- audit & preferences ------------------------------------

describe('notifications — device audit & preferences', () => {
  it('device register / revoke are audited; the token is never in metadata', async () => {
    const u = await registerUser(app);
    const reg = await registerDevice(app, u.accessToken, { token: TOKEN_A, platform: 'android' });
    await removeDevice(app, u.accessToken, reg.body.data.id as string);
    const rows = await getTestDb()('audit_logs')
      .whereIn('action', ['DEVICE_TOKEN_REGISTERED', 'DEVICE_TOKEN_REVOKED'])
      .where({ actor_user_id: u.id })
      .orderBy('created_at', 'asc')
      .select('action', 'metadata');
    expect(rows.map((r) => r.action)).toEqual(['DEVICE_TOKEN_REGISTERED', 'DEVICE_TOKEN_REVOKED']);
    expect(JSON.stringify(rows)).not.toContain(TOKEN_A);
    expect(JSON.stringify(rows)).toContain(TOKEN_A.slice(-6)); // suffix only
  });

  it('preferences round-trip and update is audited', async () => {
    const u = await registerUser(app);
    const before = await request(app)
      .get('/api/v1/notifications/preferences')
      .set(bearer(u.accessToken));
    expect(before.body.data.pushEnabled).toBe(true);
    await setPushPreference(app, u.accessToken, false);
    const after = await request(app)
      .get('/api/v1/notifications/preferences')
      .set(bearer(u.accessToken));
    expect(after.body.data.pushEnabled).toBe(false);
    const audit = await getTestDb()('audit_logs')
      .where({ action: 'NOTIFICATION_PREFERENCE_UPDATED', actor_user_id: u.id })
      .first();
    expect(audit.metadata).toMatchObject({ pushEnabled: false });
  });
});
