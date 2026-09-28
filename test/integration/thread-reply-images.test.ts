import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, fixtureBytes, registerAdmin, registerUser } from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function uploadThreadImage(slug: string, token: string): Promise<string> {
  const presign = await request(app)
    .post(`/api/v1/${slug}/attachments/upload-url`)
    .set(bearer(token))
    .send({ filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024 });
  expect(presign.status).toBe(201);
  const key = presign.body.data.storageKey as string;
  await container.objectStorage.put(key, fixtureBytes('image/jpeg', 1024), {
    contentType: 'image/jpeg',
  });
  return key;
}

describe('admin ↔ user messages carry images (support threads + replies) and links', () => {
  it('a user attaches an image to a support message; the admin replies with an image and a link', async () => {
    const user = await registerUser(app);
    const admin = await registerAdmin(app);
    const userKey = await uploadThreadImage('support-messages', user.accessToken);
    const created = await request(app)
      .post('/api/v1/support-messages')
      .set(bearer(user.accessToken))
      .send({ body: 'مشكلة في الطلب — مرفق صورة', imageKeys: [userKey] });
    expect(created.status).toBe(201);
    const threadId = created.body.data.id as string;

    const adminKey = await uploadThreadImage('support-messages', admin.accessToken);
    const reply = await request(app)
      .post(`/api/v1/support-messages/${threadId}/messages`)
      .set(bearer(admin.accessToken))
      .send({ body: 'راجع الرابط https://bytari.example/help', imageKeys: [adminKey] });
    expect(reply.status).toBe(201);
    expect(reply.body.data.imageUrls).toHaveLength(1);
    expect(reply.body.data.body).toContain('https://bytari.example/help');
    // A resolved (signed) URL, never the bare storage key / key array.
    expect(reply.body.data.imageUrls[0]).not.toBe(adminKey);
    expect(reply.body.data).not.toHaveProperty('imageKeys');

    const messages = await request(app)
      .get(`/api/v1/support-messages/${threadId}/messages`)
      .set(bearer(user.accessToken));
    const withImages = (messages.body.data as Array<{ imageUrls: string[] }>).filter(
      (m) => m.imageUrls.length > 0,
    );
    expect(withImages).toHaveLength(2);

    // An empty message is rejected.
    const empty = await request(app)
      .post(`/api/v1/support-messages/${threadId}/messages`)
      .set(bearer(user.accessToken))
      .send({ body: '' });
    expect(empty.status).toBe(422);

    // A stranger can neither read the thread nor its images.
    const stranger = await registerUser(app);
    const leak = await request(app)
      .get(`/api/v1/support-messages/${threadId}/messages`)
      .set(bearer(stranger.accessToken));
    expect(leak.status).toBe(404);
  });

  it('rejects an image key that was never uploaded', async () => {
    const user = await registerUser(app);
    const created = await request(app)
      .post('/api/v1/support-messages')
      .set(bearer(user.accessToken))
      .send({ body: 'سؤال' });
    const res = await request(app)
      .post(`/api/v1/support-messages/${created.body.data.id}/messages`)
      .set(bearer(user.accessToken))
      .send({ body: 'x', imageKeys: ['thread-attachments/does-not-exist.jpg'] });
    expect([400, 409]).toContain(res.status);
  });
});
