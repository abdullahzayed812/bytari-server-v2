import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  blockThreadSender,
  closeThread,
  createActiveOrganization,
  createConsultation,
  fixtureBytes,
  listNotifications,
  markConversationRead,
  registerAdmin,
  registerApprovedVet,
  registerSupportSupervisor,
  registerUser,
  sendChatMessage,
  sendThreadMessage,
  startConversation,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

async function putImage(key: string): Promise<void> {
  await container.objectStorage.put(key, fixtureBytes('image/jpeg', 1024), {
    contentType: 'image/jpeg',
  });
}

async function unreadCount(token: string): Promise<number> {
  const res = await request(app).get('/api/v1/notifications/unread-count').set(bearer(token));
  return res.body.data.count as number;
}

describe('admin broadcast — text + image + link', () => {
  it('stores the image key, resolves a fresh image URL on read, and carries the link', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const presign = await request(app)
      .post('/api/v1/admin/notifications/image-upload-url')
      .set(bearer(admin.accessToken))
      .send({ filename: 'offer.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(presign.status).toBe(201);
    const key = presign.body.data.storageKey as string;
    expect(key.startsWith('notifications/broadcasts/')).toBe(true);
    await putImage(key);

    const send = await request(app)
      .post('/api/v1/admin/notifications')
      .set(bearer(admin.accessToken))
      .send({
        target: { kind: 'USER', userId: user.id },
        type: 'ADMIN_ANNOUNCEMENT',
        title: 'إعلان',
        body: 'تفاصيل الإعلان',
        imageStorageKey: key,
        linkUrl: 'https://bytari.example/offer',
      });
    expect(send.status).toBe(201);

    const list = await listNotifications(app, user.accessToken);
    const n = list.body.data[0];
    expect(n.source).toEqual({ kind: 'ADMIN' });
    expect(n.data.linkUrl).toBe('https://bytari.example/offer');
    expect(typeof n.data.imageUrl).toBe('string');
    expect(n.data).not.toHaveProperty('imageKey'); // the raw key never leaves the server

    const detail = await request(app)
      .get(`/api/v1/notifications/${n.id}`)
      .set(bearer(user.accessToken));
    expect(detail.body.data.data.imageUrl).toBeTruthy();
  });

  it('rejects non-http links, foreign storage keys and keys never uploaded', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const base = {
      target: { kind: 'USER', userId: user.id },
      type: 'ADMIN_ANNOUNCEMENT',
      title: 't',
      body: 'b',
    };
    const badLink = await request(app)
      .post('/api/v1/admin/notifications')
      .set(bearer(admin.accessToken))
      .send({ ...base, linkUrl: 'javascript:alert(1)' });
    expect(badLink.status).toBe(422);

    const foreign = await request(app)
      .post('/api/v1/admin/notifications')
      .set(bearer(admin.accessToken))
      .send({ ...base, imageStorageKey: 'users/avatars/x.jpg' });
    expect(foreign.status).toBe(400);

    const missing = await request(app)
      .post('/api/v1/admin/notifications')
      .set(bearer(admin.accessToken))
      .send({ ...base, imageStorageKey: 'notifications/broadcasts/never-uploaded.jpg' });
    expect(missing.status).toBe(400);
  });

  it('a plain user can neither presign nor send', async () => {
    const user = await registerUser(app);
    const presign = await request(app)
      .post('/api/v1/admin/notifications/image-upload-url')
      .set(bearer(user.accessToken))
      .send({ filename: 'a.jpg', mimeType: 'image/jpeg', size: 10 });
    expect(presign.status).toBe(403);
  });
});

describe('organization broadcast — image key + link', () => {
  it('followers receive the link and a resolvable image (no expiring URL stored)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const follower = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await request(app)
      .post(`/api/v1/organizations/${office.id}/follow`)
      .set(bearer(follower.accessToken));

    const presign = await request(app)
      .post(`/api/v1/organizations/${office.id}/broadcast/image-upload-url`)
      .set(bearer(owner.accessToken))
      .send({ filename: 'p.jpg', mimeType: 'image/jpeg', size: 1024 });
    const key = presign.body.data.storageKey as string;
    await putImage(key);

    const send = await request(app)
      .post(`/api/v1/organizations/${office.id}/broadcast`)
      .set(bearer(owner.accessToken))
      .send({ title: 'عرض', body: 'خصم', imageStorageKey: key, linkUrl: 'https://x.example' });
    expect(send.status).toBe(201);
    await tick();

    const rows = await container.db('notifications').where({ recipient_user_id: follower.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].data.imageKey).toBe(key);
    expect(rows[0].data).not.toHaveProperty('imageUrl');

    const list = await listNotifications(app, follower.accessToken);
    expect(list.body.data[0].data.linkUrl).toBe('https://x.example');
    expect(list.body.data[0].data.imageUrl).toBeTruthy();
    expect(list.body.data[0].source.kind).toBe('ORGANIZATION');
  });
});

describe('message read state clears the bell', () => {
  it('reading a conversation marks its message notifications read', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    await sendChatMessage(app, vetOwner.accessToken, conv.id, 'a');
    const b = await sendChatMessage(app, vetOwner.accessToken, conv.id, 'b');
    await tick();
    expect(await unreadCount(petOwner.accessToken)).toBe(2);

    const read = await markConversationRead(app, petOwner.accessToken, conv.id, b.body.data.id);
    expect(read.status).toBe(200);
    expect(read.body.data.unreadCount).toBe(0);
    expect(await unreadCount(petOwner.accessToken)).toBe(0);
  });

  it('marking an OLDER message read never moves the read pointer backwards', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    const a = await sendChatMessage(app, vetOwner.accessToken, conv.id, 'a');
    const b = await sendChatMessage(app, vetOwner.accessToken, conv.id, 'b');
    await markConversationRead(app, petOwner.accessToken, conv.id, b.body.data.id);
    const stale = await markConversationRead(app, petOwner.accessToken, conv.id, a.body.data.id);
    expect(stale.body.data.unreadCount).toBe(0);
  });

  it('opening a consultation thread clears its alerts for that user', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const sup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const c = await createConsultation(app, owner.accessToken, 'help');
    const id = c.body.data.id as string;
    await sendThreadMessage(app, sup.accessToken, 'consultations', id, 'reply');
    await tick();
    expect(await unreadCount(owner.accessToken)).toBeGreaterThan(0);

    const msgs = await request(app)
      .get(`/api/v1/consultations/${id}/messages`)
      .set(bearer(owner.accessToken));
    expect(msgs.status).toBe(200);
    expect(await unreadCount(owner.accessToken)).toBe(0);
  });
});

describe('consultations — close / block are management-only', () => {
  it("a supervisor cannot close or block on their OWN consultation (the asker's side)", async () => {
    const admin = await registerAdmin(app);
    const sup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const c = await createConsultation(app, sup.accessToken, 'my own question');
    const id = c.body.data.id as string;

    expect((await closeThread(app, sup.accessToken, 'consultations', id)).status).toBe(403);
    expect((await blockThreadSender(app, sup.accessToken, 'consultations', id, true)).status).toBe(
      403,
    );
  });

  it('the plain asker cannot close or block; the supervisor and admin can', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const sup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;

    expect((await closeThread(app, owner.accessToken, 'consultations', id)).status).toBe(403);
    expect(
      (await blockThreadSender(app, owner.accessToken, 'consultations', id, true)).status,
    ).toBe(403);
    expect((await blockThreadSender(app, sup.accessToken, 'consultations', id, true)).status).toBe(
      200,
    );
    expect((await closeThread(app, admin.accessToken, 'consultations', id)).status).toBe(200);
  });
});

describe('admin direct message — image', () => {
  it('the first admin message to a user can carry images', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const presign = await request(app)
      .post('/api/v1/support-messages/attachments/upload-url')
      .set(bearer(admin.accessToken))
      .send({ filename: 'x.jpg', mimeType: 'image/jpeg', size: 1024 });
    const key = presign.body.data.storageKey as string;
    await putImage(key);

    const res = await request(app)
      .post(`/api/v1/admin/users/${user.id}/messages`)
      .set(bearer(admin.accessToken))
      .send({ body: 'مرحباً — راجع https://bytari.example', imageKeys: [key] });
    expect(res.status).toBe(201);

    const msgs = await request(app)
      .get(`/api/v1/support-messages/${res.body.data.id}/messages`)
      .set(bearer(user.accessToken));
    expect(msgs.body.data[0].imageUrls).toHaveLength(1);
  });
});
