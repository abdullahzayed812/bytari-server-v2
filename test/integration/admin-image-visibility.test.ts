import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  createAnimalPublication,
  createFarm,
  createVetCourse,
  registerAdmin,
  registerAnimalSupervisor,
  registerApprovedVet,
  registerUser,
  seedStorageObject,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/** Full presigned gallery upload cycle for one animal photo. */
async function uploadAnimalPhoto(ownerToken: string, animalId: string): Promise<void> {
  const input = { filename: 'animal.jpg', mimeType: 'image/jpeg', size: 2048 };
  const urlRes = await request(app)
    .post(`/api/v1/animals/${animalId}/gallery/upload-url`)
    .set(bearer(ownerToken))
    .send(input);
  expect(urlRes.status).toBe(201);
  const storageKey = urlRes.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, Buffer.alloc(input.size, 1), {
    contentType: input.mimeType,
  });
  const done = await request(app)
    .post(`/api/v1/animals/${animalId}/gallery`)
    .set(bearer(ownerToken))
    .send({ storageKey, mimeType: input.mimeType });
  expect(done.status).toBe(200);
}

describe('admin animal-publication moderation — the reviewer sees the animal photos', () => {
  it('the moderation list and detail join the animal summary with resolved galleryUrls', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken, { name: 'Luna' });
    await uploadAnimalPhoto(owner.accessToken, animal.id);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'ADOPTION',
    });

    const list = await request(app)
      .get('/api/v1/admin/animal-publications?status=PENDING')
      .set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    type ModerationRow = {
      id: string;
      animal: { id: string; name: string; galleryUrls: string[] };
    };
    const row = (list.body.data as ModerationRow[]).find((r) => r.id === pub.id);
    expect(row).toBeDefined();
    expect(row?.animal.id).toBe(animal.id);
    expect(row?.animal.name).toBe('Luna');
    expect(row?.animal.galleryUrls).toHaveLength(1);
    // A resolved URL, never the raw R2 key field.
    expect(row?.animal).not.toHaveProperty('galleryKeys');

    const detail = await request(app)
      .get(`/api/v1/admin/animal-publications/${pub.id}`)
      .set(bearer(admin.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.animal.galleryUrls).toHaveLength(1);
  });

  it('an animal with no photos yields an empty galleryUrls array, not a missing animal', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });

    const detail = await request(app)
      .get(`/api/v1/admin/animal-publications/${pub.id}`)
      .set(bearer(admin.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.animal.id).toBe(animal.id);
    expect(detail.body.data.animal.galleryUrls).toEqual([]);
  });

  it('an ANIMAL system supervisor sees the same photos; a plain user still gets 403', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const supervisor = await registerAnimalSupervisor(app, admin.accessToken);
    const animal = await createAnimal(app, owner.accessToken);
    await uploadAnimalPhoto(owner.accessToken, animal.id);
    await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'MATING' });

    const asSup = await request(app)
      .get('/api/v1/admin/animal-publications')
      .set(bearer(supervisor.accessToken));
    expect(asSup.status).toBe(200);
    expect(asSup.body.data[0].animal.galleryUrls).toHaveLength(1);

    const denied = await request(app)
      .get('/api/v1/admin/animal-publications')
      .set(bearer(owner.accessToken));
    expect(denied.status).toBe(403);
  });
});

describe('admin farm screens — the farm photo reaches the admin', () => {
  async function uploadFarmPhoto(ownerToken: string, organizationId: string): Promise<void> {
    const input = { filename: 'farm.jpg', mimeType: 'image/jpeg', size: 4096 };
    const urlRes = await request(app)
      .post(`/api/v1/organizations/${organizationId}/farm/profile/image/upload-url`)
      .set(bearer(ownerToken))
      .send(input);
    // the farm-profile presign responds 200 (unlike the 201 the animal gallery uses)
    expect(urlRes.status).toBe(200);
    const storageKey = urlRes.body.data.storageKey as string;
    await container.objectStorage.put(storageKey, Buffer.alloc(input.size, 1), {
      contentType: input.mimeType,
    });
    const done = await request(app)
      .post(`/api/v1/organizations/${organizationId}/farm/profile/image`)
      .set(bearer(ownerToken))
      .send({ storageKey, mimeType: input.mimeType });
    expect(done.status).toBe(200);
  }

  it('the admin farm list exposes a resolved imageUrl and never the raw imageKey', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Photo Farm' });
    await uploadFarmPhoto(owner.accessToken, farm.id);

    const res = await request(app)
      .get('/api/v1/admin/organizations/farms')
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    const row = (res.body.data as Array<Record<string, unknown>>).find(
      (r) => r.organizationId === farm.id,
    );
    expect(row).toBeDefined();
    expect(typeof row?.imageUrl).toBe('string');
    expect(row).not.toHaveProperty('imageKey');
  });

  it('a farm with no photo has imageUrl null and still lists', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Bare Farm' });

    const res = await request(app)
      .get('/api/v1/admin/organizations/farms')
      .set(bearer(admin.accessToken));
    const row = (res.body.data as Array<Record<string, unknown>>).find(
      (r) => r.organizationId === farm.id,
    );
    expect(row?.imageUrl).toBeNull();
  });

  it('GET /admin/organizations/:id attaches the FARM photo as details.imageUrl', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Detail Farm' });
    await uploadFarmPhoto(owner.accessToken, farm.id);

    const res = await request(app)
      .get(`/api/v1/admin/organizations/${farm.id}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(typeof res.body.data.details.imageUrl).toBe('string');
    // FARM has no directory profile, so these stay empty — no accidental crash.
    expect(res.body.data.details.joinCode).toBeDefined();
  });
});

describe('admin users list — avatars', () => {
  it('exposes a resolved avatarUrl per row and never the raw avatar key', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app, { firstName: 'Ava', lastName: 'Tar' });
    const { storageKey } = await seedStorageObject(
      container.objectStorage,
      StoragePrefix.userAvatars,
      Buffer.alloc(1024, 1),
      'image/png',
    );
    const finalize = await request(app)
      .post('/api/v1/users/me/avatar')
      .set(bearer(user.accessToken))
      .send({ storageKey, mimeType: 'image/png', filename: 'me.png' });
    expect(finalize.status).toBe(200);

    const list = await request(app).get('/api/v1/admin/users').set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    const row = (list.body.data as Array<Record<string, unknown>>).find((r) => r.id === user.id);
    expect(row).toBeDefined();
    expect(row?.avatarUrl).toContain(storageKey);
    expect(row).not.toHaveProperty('avatarKey');

    const detail = await request(app)
      .get(`/api/v1/admin/users/${user.id}`)
      .set(bearer(admin.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.avatarUrl).toContain(storageKey);
  });

  it('a user with no avatar has avatarUrl null', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const detail = await request(app)
      .get(`/api/v1/admin/users/${user.id}`)
      .set(bearer(admin.accessToken));
    expect(detail.body.data.avatarUrl).toBeNull();
  });
});

describe('replaced images are not orphaned in R2', () => {
  /** Presign + PUT one vet-course cover image, returning its storage key. */
  async function uploadCourseCover(token: string): Promise<string> {
    const input = { filename: 'cover.jpg', mimeType: 'image/jpeg', size: 2048 };
    const res = await request(app)
      .post('/api/v1/vet-courses/images/upload-url')
      .set(bearer(token))
      .send(input);
    expect([200, 201]).toContain(res.status);
    const storageKey = res.body.data.storageKey as string;
    await container.objectStorage.put(storageKey, Buffer.alloc(input.size, 1), {
      contentType: input.mimeType,
    });
    return storageKey;
  }

  it('replacing a vet-course cover deletes the previous R2 object', async () => {
    const vet = await registerApprovedVet(app);
    const first = await uploadCourseCover(vet.accessToken);
    const course = await createVetCourse(app, vet.accessToken);

    const setFirst = await request(app)
      .patch(`/api/v1/vet-courses/${course.id}`)
      .set(bearer(vet.accessToken))
      .send({ coverImageStorageKey: first });
    expect(setFirst.status).toBe(200);
    expect(await container.objectStorage.exists(first)).toBe(true);

    const second = await uploadCourseCover(vet.accessToken);
    const replace = await request(app)
      .patch(`/api/v1/vet-courses/${course.id}`)
      .set(bearer(vet.accessToken))
      .send({ coverImageStorageKey: second });
    expect(replace.status).toBe(200);

    expect(await container.objectStorage.exists(second)).toBe(true);
    expect(await container.objectStorage.exists(first)).toBe(false); // old object swept
  });

  it('re-sending the SAME cover key keeps the object (no self-delete)', async () => {
    const vet = await registerApprovedVet(app);
    const key = await uploadCourseCover(vet.accessToken);
    const course = await createVetCourse(app, vet.accessToken);

    await request(app)
      .patch(`/api/v1/vet-courses/${course.id}`)
      .set(bearer(vet.accessToken))
      .send({ coverImageStorageKey: key });
    const again = await request(app)
      .patch(`/api/v1/vet-courses/${course.id}`)
      .set(bearer(vet.accessToken))
      .send({ coverImageStorageKey: key });
    expect(again.status).toBe(200);
    expect(await container.objectStorage.exists(key)).toBe(true);
  });

  it('a patch that does not touch the cover leaves the existing object alone', async () => {
    const vet = await registerApprovedVet(app);
    const key = await uploadCourseCover(vet.accessToken);
    const course = await createVetCourse(app, vet.accessToken);
    await request(app)
      .patch(`/api/v1/vet-courses/${course.id}`)
      .set(bearer(vet.accessToken))
      .send({ coverImageStorageKey: key });

    const res = await request(app)
      .patch(`/api/v1/vet-courses/${course.id}`)
      .set(bearer(vet.accessToken))
      .send({ title: 'عنوان محدّث للدورة' });
    expect(res.status).toBe(200);
    expect(await container.objectStorage.exists(key)).toBe(true);
  });
});

/**
 * Regression guard for a routing bug found during the image audit: the admin
 * reports router is mounted path-less at `/admin`, and it used to attach its
 * `content_report.admin.manage` guard with `r.use(...)`. Express runs a
 * path-less `use` for EVERY request entering the router, so every admin router
 * mounted after it — `/admin/animals`, `/admin/content`, `/admin/ads`,
 * `/admin/dashboard`, the support threads, both stores — rejected any caller
 * who lacked that one unrelated permission. ADMIN holds every permission, so
 * only system supervisors were affected, which is exactly the population the
 * ManagementScreen image-review screens are built for.
 */
describe('admin routers mounted after /admin/reports stay reachable for supervisors', () => {
  it('an ANIMAL supervisor reaches /admin/animals without content_report.admin.manage', async () => {
    const admin = await registerAdmin(app);
    const supervisor = await registerAnimalSupervisor(app, admin.accessToken);

    const res = await request(app).get('/api/v1/admin/animals').set(bearer(supervisor.accessToken));
    expect(res.status).toBe(200);

    // …and the reports queue itself still requires its own permission.
    const reports = await request(app)
      .get('/api/v1/admin/reports')
      .set(bearer(supervisor.accessToken));
    expect(reports.status).toBe(403);
    expect(reports.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('an ADMIN can still read the reports queue', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app).get('/api/v1/admin/reports').set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
  });
});
