import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { InMemoryObjectStorage, type ObjectStorage } from '../../src/infra/storage/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createContent,
  createTip,
  fixtureBytes,
  registerAdmin,
  registerUser,
  uploadContentFile,
  uploadTipCover,
} from '../helpers/factories.js';

/** Storage whose deletes can be switched to fail, to prove nothing changes on a storage error. */
class SwitchableStorage extends InMemoryObjectStorage {
  failDeletes = false;
  override delete(key: string): Promise<void> {
    if (this.failDeletes) return Promise.reject(new Error('R2 unavailable'));
    return super.delete(key);
  }
}

const storage = new SwitchableStorage(null);
const { app, container } = buildTestApp({ objectStorage: storage });

beforeAll(() => ensureSchema());
beforeEach(async () => {
  storage.failDeletes = false;
  await resetDb();
});
afterAll(() => closeTestDb());

async function createNews(token: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/admin/news')
    .set(bearer(token))
    .send({ title: 'خبر مع صورة', body: 'نص الخبر' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

/** Presign → put bytes through the injected storage → register, like the app does. */
async function uploadNewsImage(
  testApp: Express,
  objectStorage: ObjectStorage,
  token: string,
  newsId: string,
  slot: 'cover' | 'gallery',
): Promise<request.Response> {
  const file = { filename: 'n.png', mimeType: 'image/png', size: 2048 };
  const urlRes = await request(testApp)
    .post(`/api/v1/admin/news/${newsId}/${slot}/upload-url`)
    .set(bearer(token))
    .send(file);
  expect(urlRes.status).toBe(201);
  const storageKey = urlRes.body.data.storageKey as string;
  await objectStorage.put(storageKey, fixtureBytes(file.mimeType, file.size), {
    contentType: file.mimeType,
  });
  return request(testApp)
    .post(`/api/v1/admin/news/${newsId}/${slot}`)
    .set(bearer(token))
    .send({ storageKey, mimeType: file.mimeType });
}

const newsRow = (id: string) => getTestDb()('news').where({ id }).first();
const tipRow = (id: string) => getTestDb()('content_tips').where({ id }).first();

describe('admin news — delete cover image', () => {
  it('clears the DB reference, deletes the object, keeps the news item and its text', async () => {
    const admin = await registerAdmin(app);
    const id = await createNews(admin.accessToken);
    expect((await uploadNewsImage(app, storage, admin.accessToken, id, 'cover')).status).toBe(201);
    const key = (await newsRow(id)).cover_image_storage_key as string;
    expect(await storage.exists(key)).toBe(true);

    const res = await request(app)
      .delete(`/api/v1/admin/news/${id}/cover`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.coverImageUrl).toBeNull();
    expect(res.body.data.title).toBe('خبر مع صورة');

    const row = await newsRow(id);
    expect(row.cover_image_storage_key).toBeNull();
    expect(row.cover_image_storage_provider).toBeNull();
    expect(row.body).toBe('نص الخبر');
    expect(row.deleted_at).toBeNull();
    expect(await storage.exists(key)).toBe(false);

    const audit = await getTestDb()('audit_logs')
      .where({ entity_id: id, action: 'NEWS_COVER_DELETED' })
      .first();
    expect(audit).toBeTruthy();
  });

  it('succeeds when the object is already missing from storage', async () => {
    const admin = await registerAdmin(app);
    const id = await createNews(admin.accessToken);
    await uploadNewsImage(app, storage, admin.accessToken, id, 'cover');
    const key = (await newsRow(id)).cover_image_storage_key as string;
    await storage.delete(key);

    const res = await request(app)
      .delete(`/api/v1/admin/news/${id}/cover`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect((await newsRow(id)).cover_image_storage_key).toBeNull();
  });

  it('404 when the item has no cover; 404 for an unknown item', async () => {
    const admin = await registerAdmin(app);
    const id = await createNews(admin.accessToken);
    await request(app)
      .delete(`/api/v1/admin/news/${id}/cover`)
      .set(bearer(admin.accessToken))
      .expect(404);
    await request(app)
      .delete('/api/v1/admin/news/00000000-0000-4000-8000-000000000000/cover')
      .set(bearer(admin.accessToken))
      .expect(404);
  });

  it('a storage failure returns 503 and changes nothing (reference + object kept)', async () => {
    const admin = await registerAdmin(app);
    const id = await createNews(admin.accessToken);
    await uploadNewsImage(app, storage, admin.accessToken, id, 'cover');
    const key = (await newsRow(id)).cover_image_storage_key as string;

    storage.failDeletes = true;
    const res = await request(app)
      .delete(`/api/v1/admin/news/${id}/cover`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(503);
    expect((await newsRow(id)).cover_image_storage_key).toBe(key);
    expect(await storage.exists(key)).toBe(true);
    const audit = await getTestDb()('audit_logs')
      .where({ entity_id: id, action: 'NEWS_COVER_DELETED' })
      .first();
    expect(audit).toBeUndefined();

    // Retry once storage recovers.
    storage.failDeletes = false;
    await request(app)
      .delete(`/api/v1/admin/news/${id}/cover`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(await storage.exists(key)).toBe(false);
  });

  it('keeps an object that another record still references', async () => {
    const admin = await registerAdmin(app);
    const a = await createNews(admin.accessToken);
    const b = await createNews(admin.accessToken);
    await uploadNewsImage(app, storage, admin.accessToken, a, 'cover');
    const key = (await newsRow(a)).cover_image_storage_key as string;
    await getTestDb()('news')
      .where({ id: b })
      .update({ gallery_keys: [key] });

    await request(app)
      .delete(`/api/v1/admin/news/${a}/cover`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((await newsRow(a)).cover_image_storage_key).toBeNull();
    expect(await storage.exists(key)).toBe(true);
  });

  it('requires an admin content permission', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const id = await createNews(admin.accessToken);
    await uploadNewsImage(app, storage, admin.accessToken, id, 'cover');
    await request(app)
      .delete(`/api/v1/admin/news/${id}/cover`)
      .set(bearer(user.accessToken))
      .expect(403);
    expect((await newsRow(id)).cover_image_storage_key).not.toBeNull();
  });
});

describe('admin news — delete gallery photo', () => {
  it('removes the key and the object; a storage failure keeps both', async () => {
    const admin = await registerAdmin(app);
    const id = await createNews(admin.accessToken);
    await uploadNewsImage(app, storage, admin.accessToken, id, 'gallery');
    await uploadNewsImage(app, storage, admin.accessToken, id, 'gallery');
    const [first, second] = (await newsRow(id)).gallery_keys as string[];

    storage.failDeletes = true;
    await request(app)
      .delete(`/api/v1/admin/news/${id}/gallery`)
      .query({ storageKey: first })
      .set(bearer(admin.accessToken))
      .expect(503);
    expect((await newsRow(id)).gallery_keys).toEqual([first, second]);

    storage.failDeletes = false;
    const res = await request(app)
      .delete(`/api/v1/admin/news/${id}/gallery`)
      .query({ storageKey: first })
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.galleryUrls).toHaveLength(1);
    expect((await newsRow(id)).gallery_keys).toEqual([second]);
    expect(await storage.exists(first!)).toBe(false);
    expect(await storage.exists(second!)).toBe(true);
  });
});

describe('admin tips — delete cover image', () => {
  it('clears the reference, deletes the object, keeps the tip', async () => {
    const admin = await registerAdmin(app);
    const id = (await createTip(app, admin.accessToken)).body.data.id as string;
    expect((await uploadTipCover(app, container, admin.accessToken, id)).status).toBe(201);
    const key = (await tipRow(id)).cover_image_storage_key as string;

    const res = await request(app)
      .delete(`/api/v1/admin/tips/${id}/cover`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.coverImageUrl).toBeNull();
    const row = await tipRow(id);
    expect(row.cover_image_storage_key).toBeNull();
    expect(row.title).toBeTruthy();
    expect(row.deleted_at).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it('missing object → 200; no cover → 404; storage failure → 503 with nothing changed', async () => {
    const admin = await registerAdmin(app);
    const id = (await createTip(app, admin.accessToken)).body.data.id as string;
    await request(app)
      .delete(`/api/v1/admin/tips/${id}/cover`)
      .set(bearer(admin.accessToken))
      .expect(404);

    await uploadTipCover(app, container, admin.accessToken, id);
    const key = (await tipRow(id)).cover_image_storage_key as string;
    storage.failDeletes = true;
    await request(app)
      .delete(`/api/v1/admin/tips/${id}/cover`)
      .set(bearer(admin.accessToken))
      .expect(503);
    expect((await tipRow(id)).cover_image_storage_key).toBe(key);
    expect(await storage.exists(key)).toBe(true);

    storage.failDeletes = false;
    await storage.delete(key);
    await request(app)
      .delete(`/api/v1/admin/tips/${id}/cover`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((await tipRow(id)).cover_image_storage_key).toBeNull();
  });
});

describe('admin books — delete cover image', () => {
  async function bookWithCover(token: string) {
    const id = (await createContent(app, token, { type: 'BOOK', title: 'كتاب' })).body.data
      .id as string;
    const up = await uploadContentFile(app, container, token, id, {
      kind: 'COVER',
      filename: 'c.png',
      mimeType: 'image/png',
      size: 2048,
    });
    expect(up.status).toBe(201);
    const file = (up.body.data.files as { id: string; kind: string; storageKey: string }[]).find(
      (f) => f.kind === 'COVER',
    )!;
    return { id, fileId: file.id, key: file.storageKey };
  }

  it('removes the file row and the object; the book stays', async () => {
    const admin = await registerAdmin(app);
    const { id, fileId, key } = await bookWithCover(admin.accessToken);

    const res = await request(app)
      .delete(`/api/v1/admin/content/${id}/files/${fileId}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.coverUrl).toBeNull();
    expect(res.body.data.title).toBe('كتاب');
    expect(await getTestDb()('content_files').where({ id: fileId }).first()).toBeUndefined();
    expect(await storage.exists(key)).toBe(false);
    expect(await getTestDb()('contents').where({ id }).first()).toBeTruthy();
  });

  it('missing object → 200; storage failure → 503 with the row and object kept', async () => {
    const admin = await registerAdmin(app);
    const { id, fileId, key } = await bookWithCover(admin.accessToken);

    storage.failDeletes = true;
    await request(app)
      .delete(`/api/v1/admin/content/${id}/files/${fileId}`)
      .set(bearer(admin.accessToken))
      .expect(503);
    const kept = await getTestDb()('content_files').where({ id: fileId }).first();
    expect(kept.deleted_at).toBeNull();
    expect(await storage.exists(key)).toBe(true);

    storage.failDeletes = false;
    await storage.delete(key);
    await request(app)
      .delete(`/api/v1/admin/content/${id}/files/${fileId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(await getTestDb()('content_files').where({ id: fileId }).first()).toBeUndefined();
  });
});
