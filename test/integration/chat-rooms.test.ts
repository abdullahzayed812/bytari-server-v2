import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, fixtureBytes, registerAdmin, registerUser } from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function createRoom(
  adminToken: string,
  overrides: Partial<{ name: string; rules: string }> = {},
) {
  const res = await request(app)
    .post('/api/v1/admin/chat-rooms')
    .set(bearer(adminToken))
    .send({
      name: overrides.name ?? 'الأغنام والماعز',
      description: 'كل ما يخص رعاية الأغنام',
      rules: overrides.rules,
    });
  if (res.status !== 201)
    throw new Error(`createRoom failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; conversationId: string; memberCount: number };
}

describe('Global Chat rooms — conversations inbox', () => {
  it('a joined room appears in GET /conversations (vet or pet owner alike); leaving removes it; strangers never see it', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const member = await registerUser(app);
    const stranger = await registerUser(app);

    await request(app).post(`/api/v1/chat-rooms/${room.id}/join`).set(bearer(member.accessToken));
    const inbox = await request(app).get('/api/v1/conversations').set(bearer(member.accessToken));
    expect(inbox.status).toBe(200);
    const entry = inbox.body.data.find((c: { id: string }) => c.id === room.conversationId);
    expect(entry).toMatchObject({
      type: 'CHAT_ROOM',
      organizationId: room.id,
      viewerSide: 'ROOM_MEMBER',
    });

    const other = await request(app).get('/api/v1/conversations').set(bearer(stranger.accessToken));
    expect(other.body.data.map((c: { id: string }) => c.id)).not.toContain(room.conversationId);

    await request(app).post(`/api/v1/chat-rooms/${room.id}/leave`).set(bearer(member.accessToken));
    const after = await request(app).get('/api/v1/conversations').set(bearer(member.accessToken));
    expect(after.body.data.map((c: { id: string }) => c.id)).not.toContain(room.conversationId);
  });
});

describe('Global Chat rooms — create / browse / join / leave / mute', () => {
  it('only an admin can create a room; a plain user gets 403', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/admin/chat-rooms')
      .set(bearer(user.accessToken))
      .send({ name: 'الدواجن' });
    expect(res.status).toBe(403);
  });

  it('creates a room ACTIVE immediately, with the owner already a member and its own conversation', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    expect(room.memberCount).toBe(1);
    expect(room.conversationId).toBeTruthy();

    const list = await request(app).get('/api/v1/chat-rooms').set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    const found = list.body.data.find((r: { id: string }) => r.id === room.id);
    expect(found).toBeTruthy();
    expect(found.isJoined).toBe(true);
    expect(found.memberCount).toBe(1);
  });

  it('any registered user can join, then send and read messages via the existing conversation endpoints', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const member = await registerUser(app);

    const join = await request(app)
      .post(`/api/v1/chat-rooms/${room.id}/join`)
      .set(bearer(member.accessToken));
    expect(join.status).toBe(201);
    expect(join.body.data.isJoined).toBe(true);
    expect(join.body.data.memberCount).toBe(2);

    const send = await request(app)
      .post(`/api/v1/conversations/${room.conversationId}/messages`)
      .set(bearer(member.accessToken))
      .send({ body: 'مرحباً بالجميع' });
    expect(send.status).toBe(201);

    const messages = await request(app)
      .get(`/api/v1/conversations/${room.conversationId}/messages`)
      .set(bearer(admin.accessToken));
    expect(messages.status).toBe(200);
    expect(messages.body.data.map((m: { body: string }) => m.body)).toContain('مرحباً بالجميع');
  });

  it('a non-member gets 404 (not 403) trying to read or send in the room conversation', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const outsider = await registerUser(app);

    const send = await request(app)
      .post(`/api/v1/conversations/${room.conversationId}/messages`)
      .set(bearer(outsider.accessToken))
      .send({ body: 'hello' });
    expect(send.status).toBe(404);

    const read = await request(app)
      .get(`/api/v1/conversations/${room.conversationId}/messages`)
      .set(bearer(outsider.accessToken));
    expect(read.status).toBe(404);
  });

  it('unread counts track per member and mute/leave/rejoin all work', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const member = await registerUser(app);
    await request(app).post(`/api/v1/chat-rooms/${room.id}/join`).set(bearer(member.accessToken));

    await request(app)
      .post(`/api/v1/conversations/${room.conversationId}/messages`)
      .set(bearer(admin.accessToken))
      .send({ body: 'إعلان مهم' });

    const before = await request(app)
      .get(`/api/v1/chat-rooms/${room.id}`)
      .set(bearer(member.accessToken));
    expect(before.body.data.unreadCount).toBe(1);

    // Mute — no effect on unread count, just notification fan-out.
    const mute = await request(app)
      .post(`/api/v1/chat-rooms/${room.id}/mute`)
      .set(bearer(member.accessToken))
      .send({ muted: true });
    expect(mute.status).toBe(200);
    const muted = await request(app)
      .get(`/api/v1/chat-rooms/${room.id}`)
      .set(bearer(member.accessToken));
    expect(muted.body.data.notificationsMuted).toBe(true);

    // Leave, then rejoin — membership + participant both restored.
    const leave = await request(app)
      .post(`/api/v1/chat-rooms/${room.id}/leave`)
      .set(bearer(member.accessToken));
    expect(leave.status).toBe(200);

    const afterLeaveSend = await request(app)
      .post(`/api/v1/conversations/${room.conversationId}/messages`)
      .set(bearer(member.accessToken))
      .send({ body: 'still here?' });
    expect(afterLeaveSend.status).toBe(404);

    const rejoin = await request(app)
      .post(`/api/v1/chat-rooms/${room.id}/join`)
      .set(bearer(member.accessToken));
    expect(rejoin.status).toBe(201);
    expect(rejoin.body.data.isJoined).toBe(true);
  });

  it('any member can list the room roster; a non-member gets 404', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const member = await registerUser(app);
    const outsider = await registerUser(app);
    await request(app).post(`/api/v1/chat-rooms/${room.id}/join`).set(bearer(member.accessToken));

    const list = await request(app)
      .get(`/api/v1/chat-rooms/${room.id}/members`)
      .set(bearer(member.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [admin.id, member.id].sort(),
    );

    const forbidden = await request(app)
      .get(`/api/v1/chat-rooms/${room.id}/members`)
      .set(bearer(outsider.accessToken));
    expect(forbidden.status).toBe(404);
  });

  it('the room owner cannot leave (must transfer ownership first)', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const res = await request(app)
      .post(`/api/v1/chat-rooms/${room.id}/leave`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(409);
  });
});

describe('Global Chat rooms — moderation (chat_room.rules.manage / chat_room.message.delete)', () => {
  it('an assigned moderator can update rules, pin a message and delete another member’s message; a plain member cannot', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const moderator = await registerUser(app);
    const member = await registerUser(app);
    await request(app)
      .post(`/api/v1/chat-rooms/${room.id}/join`)
      .set(bearer(moderator.accessToken));
    await request(app).post(`/api/v1/chat-rooms/${room.id}/join`).set(bearer(member.accessToken));

    const assign = await request(app)
      .post(`/api/v1/organizations/${room.id}/supervisors`)
      .set(bearer(admin.accessToken))
      .send({
        email: moderator.email,
        permissions: ['chat_room.rules.manage', 'chat_room.message.delete'],
      });
    expect(assign.status).toBe(201);

    // Rules — moderator can, plain member cannot.
    const ruleUpdate = await request(app)
      .patch(`/api/v1/chat-rooms/${room.id}/rules`)
      .set(bearer(moderator.accessToken))
      .send({ rules: 'يرجى الالتزام بالقوانين' });
    expect(ruleUpdate.status).toBe(200);
    const forbiddenRuleUpdate = await request(app)
      .patch(`/api/v1/chat-rooms/${room.id}/rules`)
      .set(bearer(member.accessToken))
      .send({ rules: 'x' });
    expect(forbiddenRuleUpdate.status).toBe(403);

    // Pin a message the member sent.
    const sent = await request(app)
      .post(`/api/v1/conversations/${room.conversationId}/messages`)
      .set(bearer(member.accessToken))
      .send({ body: 'رسالة مهمة' });
    const messageId = sent.body.data.id as string;
    const pin = await request(app)
      .post(`/api/v1/chat-rooms/${room.id}/messages/${messageId}/pin`)
      .set(bearer(moderator.accessToken));
    expect(pin.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/chat-rooms/${room.id}`)
      .set(bearer(member.accessToken));
    expect(detail.body.data.pinnedMessage.id).toBe(messageId);

    // Moderator deletes the member's message (their OWN /messages/:id delete
    // route would 403 for anyone but the sender — this is the separate
    // moderator-only route).
    const modDelete = await request(app)
      .delete(`/api/v1/chat-rooms/${room.id}/messages/${messageId}`)
      .set(bearer(moderator.accessToken));
    expect(modDelete.status).toBe(200);

    const forbiddenDelete = await request(app)
      .delete(`/api/v1/chat-rooms/${room.id}/messages/${messageId}`)
      .set(bearer(member.accessToken));
    expect(forbiddenDelete.status).toBe(403);
  });
});

describe('Global Chat rooms — admin-managed room image', () => {
  async function uploadImage(token: string, roomId: string) {
    const upload = await request(app)
      .post(`/api/v1/organizations/${roomId}/logo/upload-url`)
      .set(bearer(token))
      .send({ filename: 'room.jpg', mimeType: 'image/jpeg', size: 1024 });
    if (upload.status !== 201) return upload;
    const storageKey = upload.body.data.storageKey as string;
    await container.objectStorage.put(storageKey, fixtureBytes('image/jpeg', 1024), {
      contentType: 'image/jpeg',
    });
    return request(app)
      .post(`/api/v1/organizations/${roomId}/logo`)
      .set(bearer(token))
      .send({ storageKey, mimeType: 'image/jpeg' });
  }

  it('an admin sets, replaces and removes a room image; every room shows its own (or the icon fallback)', async () => {
    const admin = await registerAdmin(app);
    const withImage = await createRoom(admin.accessToken, { name: 'الدواجن' });
    const plain = await createRoom(admin.accessToken, { name: 'الأبقار' });
    const member = await registerUser(app);

    const set = await uploadImage(admin.accessToken, withImage.id);
    expect(set.status).toBe(200);
    const firstUrl = set.body.data.details.logoUrl as string;
    expect(firstUrl).toBeTruthy();

    const list = await request(app).get('/api/v1/chat-rooms').set(bearer(member.accessToken));
    const byId = new Map(
      (list.body.data as { id: string; logoUrl: string | null }[]).map((r) => [r.id, r.logoUrl]),
    );
    expect(byId.get(withImage.id)).toBeTruthy();
    expect(byId.get(plain.id)).toBeNull();
    const detail = await request(app)
      .get(`/api/v1/chat-rooms/${withImage.id}`)
      .set(bearer(member.accessToken));
    expect(detail.body.data.logoUrl).toBeTruthy();

    const replaced = await uploadImage(admin.accessToken, withImage.id);
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.details.logoUrl).toBeTruthy();
    expect(replaced.body.data.details.logoUrl).not.toBe(firstUrl);

    const removed = await request(app)
      .delete(`/api/v1/organizations/${withImage.id}/logo`)
      .set(bearer(admin.accessToken));
    expect(removed.status).toBe(200);
    const after = await request(app)
      .get(`/api/v1/chat-rooms/${withImage.id}`)
      .set(bearer(member.accessToken));
    expect(after.body.data.logoUrl).toBeNull();
  });

  it('a room member (non-admin) cannot change the room image', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const member = await registerUser(app);
    await request(app).post(`/api/v1/chat-rooms/${room.id}/join`).set(bearer(member.accessToken));

    const res = await uploadImage(member.accessToken, room.id);
    expect(res.status).toBe(403);
    const del = await request(app)
      .delete(`/api/v1/organizations/${room.id}/logo`)
      .set(bearer(member.accessToken));
    expect(del.status).toBe(403);
  });

  it('rejects a non-image upload', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const res = await request(app)
      .post(`/api/v1/organizations/${room.id}/logo/upload-url`)
      .set(bearer(admin.accessToken))
      .send({ filename: 'room.pdf', mimeType: 'application/pdf', size: 1024 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
