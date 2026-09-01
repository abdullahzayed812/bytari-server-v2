import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerUser, seedStorageObject } from '../helpers/factories.js';

const storage = new InMemoryObjectStorage(null);
const { app } = buildTestApp({ objectStorage: storage });

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  storage.clear();
});
afterAll(() => closeTestDb());

async function requestUploadUrl(
  token: string,
  body: { filename: string; mimeType: string; size: number },
): Promise<request.Response> {
  return request(app)
    .post('/api/v1/users/me/avatar/upload-url')
    .set(bearer(token))
    .send(body);
}

async function finalizeAvatar(
  token: string,
  body: { storageKey: string; mimeType: string; filename: string },
): Promise<request.Response> {
  return request(app).post('/api/v1/users/me/avatar').set(bearer(token)).send(body);
}

describe('avatar upload — presigned URL', () => {
  it('issues a storage key under users/avatars/', async () => {
    const u = await registerUser(app);
    const res = await requestUploadUrl(u.accessToken, {
      filename: 'me.png',
      mimeType: 'image/png',
      size: 1024,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.storageKey.startsWith(`${StoragePrefix.userAvatars}/`)).toBe(true);
    expect(res.body.data.method).toBe('PUT');
  });

  it('rejects a disallowed MIME (400) and an oversized declared size (422)', async () => {
    const u = await registerUser(app);
    const bad = await requestUploadUrl(u.accessToken, {
      filename: 'me.gif',
      mimeType: 'image/gif',
      size: 1024,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const big = await requestUploadUrl(u.accessToken, {
      filename: 'me.png',
      mimeType: 'image/png',
      size: 999_999_999,
    });
    expect(big.status).toBe(422);
  });
});

describe('avatar finalize', () => {
  it('happy path: finalize updates the user avatarKey', async () => {
    const u = await registerUser(app);
    const { storageKey } = await seedStorageObject(
      storage,
      StoragePrefix.userAvatars,
      Buffer.alloc(2048, 1),
      'image/png',
    );
    const res = await finalizeAvatar(u.accessToken, {
      storageKey,
      mimeType: 'image/png',
      filename: 'me.png',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.avatarKey).toBe(storageKey);

    const row = await getTestDb()('users').where({ id: u.id }).first();
    expect(row.avatar_key).toBe(storageKey);
  });

  it('rejects a storage key outside users/avatars/ (409 STORAGE_KEY_MISMATCH)', async () => {
    const u = await registerUser(app);
    const res = await finalizeAvatar(u.accessToken, {
      storageKey: 'content/books/2026/08/evil.png',
      mimeType: 'image/png',
      filename: 'me.png',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STORAGE_KEY_MISMATCH');
  });

  it('rejects when no object exists at the key (400 STORAGE_OBJECT_MISSING)', async () => {
    const u = await registerUser(app);
    const res = await finalizeAvatar(u.accessToken, {
      storageKey: `${StoragePrefix.userAvatars}/2026/08/never-uploaded.png`,
      mimeType: 'image/png',
      filename: 'me.png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STORAGE_OBJECT_MISSING');
  });

  it('re-validates the REAL mime/size from storage.head() over the client-declared values', async () => {
    const u = await registerUser(app);
    // Real object is a PDF (disallowed) even though the client declares image/png.
    const { storageKey } = await seedStorageObject(
      storage,
      StoragePrefix.userAvatars,
      Buffer.alloc(64, 1),
      'application/pdf',
    );
    const res = await finalizeAvatar(u.accessToken, {
      storageKey,
      mimeType: 'image/png',
      filename: 'me.png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('replacing an avatar best-effort-deletes the old object', async () => {
    const u = await registerUser(app);
    const first = await seedStorageObject(
      storage,
      StoragePrefix.userAvatars,
      Buffer.alloc(100, 1),
      'image/png',
    );
    await finalizeAvatar(u.accessToken, {
      storageKey: first.storageKey,
      mimeType: 'image/png',
      filename: 'v1.png',
    });
    expect(await storage.exists(first.storageKey)).toBe(true);

    const second = await seedStorageObject(
      storage,
      StoragePrefix.userAvatars,
      Buffer.alloc(200, 1),
      'image/png',
    );
    const res = await finalizeAvatar(u.accessToken, {
      storageKey: second.storageKey,
      mimeType: 'image/png',
      filename: 'v2.png',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.avatarKey).toBe(second.storageKey);
    expect(await storage.exists(first.storageKey)).toBe(false); // old object cleaned up
  });

  it('a storage delete failure after commit does not fail the finalize call', async () => {
    class FlakyStorage extends InMemoryObjectStorage {
      override delete(): Promise<void> {
        return Promise.reject(new Error('R2 unavailable'));
      }
    }
    const flaky = new FlakyStorage(null);
    const h = buildTestApp({ objectStorage: flaky });
    await resetDb();
    const u = await registerUser(h.app);

    const first = await seedStorageObject(
      flaky,
      StoragePrefix.userAvatars,
      Buffer.alloc(50, 1),
      'image/png',
    );
    await request(h.app)
      .post('/api/v1/users/me/avatar')
      .set(bearer(u.accessToken))
      .send({ storageKey: first.storageKey, mimeType: 'image/png', filename: 'v1.png' });

    const second = await seedStorageObject(
      flaky,
      StoragePrefix.userAvatars,
      Buffer.alloc(60, 1),
      'image/png',
    );
    const res = await request(h.app)
      .post('/api/v1/users/me/avatar')
      .set(bearer(u.accessToken))
      .send({ storageKey: second.storageKey, mimeType: 'image/png', filename: 'v2.png' });
    expect(res.status).toBe(200); // storage error logged, not surfaced
    expect(res.body.data.avatarKey).toBe(second.storageKey);
  });
});

describe('avatar upload — rate limit routes reachable via /users/me/*', () => {
  it('POST /users/me/avatar/upload-url is not shadowed by the /users/:id route', async () => {
    const u = await registerUser(app);
    const res = await requestUploadUrl(u.accessToken, {
      filename: 'me.png',
      mimeType: 'image/png',
      size: 10,
    });
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(422); // would be 422 if `me` were parsed as a :id uuid param
  });
});
