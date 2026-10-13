import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  registerAdmin,
  registerApprovedVet,
  registerModerator,
  registerUser,
  seedStorageObject,
} from '../helpers/factories.js';

const storage = new InMemoryObjectStorage(null);
const { app } = buildTestApp({ objectStorage: storage });
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  storage.clear();
});
afterAll(() => closeTestDb());

const ALL_KEYS = [
  'PET_OWNER_PETS',
  'PET_OWNER_LIVESTOCK',
  'PET_OWNER_POULTRY',
  'VET_CHAT',
  'VET_SERVICES',
  'VET_MAGAZINE',
  'VET_BOOKS',
];

interface Section {
  key: string;
  page: string;
  imageUrl: string | null;
}

/** A finished upload under the section's own prefix (what the upload URL would produce). */
function seedSectionImage(key: string, mime = 'image/png', bytes = 256) {
  return seedStorageObject(
    storage,
    `${StoragePrefix.homeSectionImages}/${key.toLowerCase()}`,
    Buffer.alloc(bytes, 1),
    mime,
  );
}

async function register(token: string, key: string, storageKey: string, mimeType = 'image/png') {
  return request(app)
    .post(`${API}/admin/home-sections/${key}/image`)
    .set(bearer(token))
    .send({ storageKey, mimeType });
}

describe('home section images — public read', () => {
  it('any signed-in user gets every existing section with imageUrl null by default (built-in icon fallback)', async () => {
    const user = await registerUser(app);
    const res = await request(app).get(`${API}/home-sections`).set(bearer(user.accessToken));
    expect(res.status).toBe(200);
    expect((res.body.data as Section[]).map((s) => s.key)).toEqual(ALL_KEYS);
    expect((res.body.data as Section[]).every((s) => s.imageUrl === null)).toBe(true);
    expect((res.body.data as Section[]).find((s) => s.key === 'VET_BOOKS')?.page).toBe(
      'VETERINARIAN_HOME',
    );
    expect((res.body.data as Section[]).find((s) => s.key === 'PET_OWNER_PETS')?.page).toBe(
      'PET_OWNER_HOME',
    );
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`${API}/home-sections`);
    expect(res.status).toBe(401);
  });
});

describe('home section images — admin management', () => {
  it('admin uploads, replaces and removes a section image; users see each change', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const presign = await request(app)
      .post(`${API}/admin/home-sections/PET_OWNER_POULTRY/image/upload-url`)
      .set(bearer(admin.accessToken))
      .send({ filename: 'poultry.png', mimeType: 'image/png', size: 2048 });
    expect(presign.status).toBe(200);
    expect(presign.body.data.storageKey.startsWith('home-sections/pet_owner_poultry/')).toBe(true);
    expect(presign.body.data.method).toBe('PUT');

    const first = await seedSectionImage('PET_OWNER_POULTRY');
    const set = await register(admin.accessToken, 'PET_OWNER_POULTRY', first.storageKey);
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ key: 'PET_OWNER_POULTRY', page: 'PET_OWNER_HOME' });
    expect(set.body.data.imageUrl).toContain(first.storageKey);

    const seen = await request(app).get(`${API}/home-sections`).set(bearer(user.accessToken));
    const poultry = (seen.body.data as Section[]).find((s) => s.key === 'PET_OWNER_POULTRY');
    expect(poultry?.imageUrl).toContain(first.storageKey);
    // Other sections are untouched (still the icon fallback).
    expect((seen.body.data as Section[]).filter((s) => s.imageUrl !== null)).toHaveLength(1);

    // Replace → the old object is cleaned up, one row per section.
    const second = await seedSectionImage('PET_OWNER_POULTRY', 'image/webp');
    const replaced = await register(
      admin.accessToken,
      'PET_OWNER_POULTRY',
      second.storageKey,
      'image/webp',
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.imageUrl).toContain(second.storageKey);
    expect(await storage.exists(first.storageKey)).toBe(false);
    expect(
      await getTestDb()('home_section_images').count<{ count: string }[]>('* as count'),
    ).toEqual([{ count: '1' }]);

    // Remove → back to the icon; removing again is a no-op.
    const removed = await request(app)
      .delete(`${API}/admin/home-sections/PET_OWNER_POULTRY/image`)
      .set(bearer(admin.accessToken));
    expect(removed.status).toBe(200);
    expect(removed.body.data.imageUrl).toBeNull();
    expect(await storage.exists(second.storageKey)).toBe(false);
    const again = await request(app)
      .delete(`${API}/admin/home-sections/PET_OWNER_POULTRY/image`)
      .set(bearer(admin.accessToken));
    expect(again.status).toBe(200);

    const audit = await getTestDb()('audit_logs')
      .whereIn('action', ['HOME_SECTION_IMAGE_UPDATED', 'HOME_SECTION_IMAGE_REMOVED'])
      .select('action');
    expect(audit.map((a: { action: string }) => a.action).sort()).toEqual([
      'HOME_SECTION_IMAGE_REMOVED',
      'HOME_SECTION_IMAGE_UPDATED',
      'HOME_SECTION_IMAGE_UPDATED',
    ]);
  });

  it('only admins may manage: plain users, vets and moderators get 403 on every admin route', async () => {
    const user = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const moderator = await registerModerator(app);
    const img = await seedSectionImage('VET_CHAT');

    for (const token of [user.accessToken, vet.accessToken, moderator.accessToken]) {
      const list = await request(app).get(`${API}/admin/home-sections`).set(bearer(token));
      expect(list.status).toBe(403);
      const presign = await request(app)
        .post(`${API}/admin/home-sections/VET_CHAT/image/upload-url`)
        .set(bearer(token))
        .send({ filename: 'a.png', mimeType: 'image/png', size: 100 });
      expect(presign.status).toBe(403);
      expect((await register(token, 'VET_CHAT', img.storageKey)).status).toBe(403);
      const del = await request(app)
        .delete(`${API}/admin/home-sections/VET_CHAT/image`)
        .set(bearer(token));
      expect(del.status).toBe(403);
    }
    expect(await getTestDb()('home_section_images').first()).toBeUndefined();
  });

  it('validates uploads: unknown section, bad type, oversize, foreign/missing key, real mime', async () => {
    const admin = await registerAdmin(app);
    const presign = (key: string, body: object) =>
      request(app)
        .post(`${API}/admin/home-sections/${key}/image/upload-url`)
        .set(bearer(admin.accessToken))
        .send(body);

    // A section that does not exist cannot be created through this API.
    expect(
      (await presign('VET_NEW_SECTION', { filename: 'a.png', mimeType: 'image/png', size: 1 }))
        .status,
    ).toBe(422);
    // Images only, ≤ 10 MB.
    expect(
      (await presign('VET_CHAT', { filename: 'a.gif', mimeType: 'image/gif', size: 10 })).status,
    ).toBe(422);
    expect(
      (
        await presign('VET_CHAT', {
          filename: 'a.png',
          mimeType: 'image/png',
          size: 11 * 1024 * 1024,
        })
      ).status,
    ).toBe(422);

    // A key from another section / domain is refused.
    const otherSection = await seedSectionImage('VET_BOOKS');
    const wrong = await register(admin.accessToken, 'VET_CHAT', otherSection.storageKey);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('STORAGE_KEY_MISMATCH');
    const foreign = await seedStorageObject(
      storage,
      StoragePrefix.advertisements,
      Buffer.alloc(64, 1),
      'image/png',
    );
    expect((await register(admin.accessToken, 'VET_CHAT', foreign.storageKey)).status).toBe(400);

    // Nothing was uploaded at that key.
    const missing = await register(
      admin.accessToken,
      'VET_CHAT',
      'home-sections/vet_chat/none.png',
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('STORAGE_OBJECT_MISSING');

    // The REAL stored type wins over the declared one.
    const pdf = await seedSectionImage('VET_CHAT', 'application/pdf');
    const disguised = await register(admin.accessToken, 'VET_CHAT', pdf.storageKey);
    expect(disguised.status).toBe(400);
    expect(disguised.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    expect(await getTestDb()('home_section_images').first()).toBeUndefined();
  });
});
