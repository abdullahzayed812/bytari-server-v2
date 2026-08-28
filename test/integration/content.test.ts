import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  archiveContent,
  bearer,
  createCategory,
  createContent,
  publishContent,
  registerAdmin,
  registerApprovedVet,
  registerContentSupervisor,
  registerModerator,
  registerUser,
  assignSystemSupervisor,
  uploadContentFile,
} from '../helpers/factories.js';

const storage = new InMemoryObjectStorage(null);
const { app, container } = buildTestApp({ objectStorage: storage });

const events: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('content.')) events.push(e.name);
});
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  storage.clear();
  events.length = 0;
});
afterAll(() => closeTestDb());

async function auditRows(
  entityId: string,
): Promise<
  Array<{ action: string; actor_user_id: string | null; metadata: Record<string, unknown> }>
> {
  return getTestDb()('audit_logs')
    .where({ entity_id: entityId })
    .orderBy('created_at', 'asc')
    .select('action', 'actor_user_id', 'metadata');
}

// --- creation -----------------------------------------------------

describe('content — creation', () => {
  it('an admin creates an article; creator is derived from the token; it starts DRAFT', async () => {
    const admin = await registerAdmin(app);
    const res = await createContent(app, admin.accessToken, {
      type: 'ARTICLE',
      title: 'Caring for senior cats',
      description: 'A practical guide',
      body: 'Line one.\nLine two.',
      authorName: 'Dr. Vet',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'ARTICLE',
      status: 'DRAFT',
      title: 'Caring for senior cats',
      createdByUserId: admin.id,
    });
    expect(events).toEqual(['content.created']);
  });

  it('a CONTENT supervisor (approved vet) can create content', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerContentSupervisor(app, admin.accessToken);
    const res = await createContent(app, sup.accessToken, { type: 'BOOK', title: 'Vet Surgery' });
    expect(res.status).toBe(201);
    expect(res.body.data.createdByUserId).toBe(sup.id);
  });

  it('a normal user cannot create content (403)', async () => {
    const user = await registerUser(app);
    expect(
      (await createContent(app, user.accessToken, { type: 'ARTICLE', title: 'x' })).status,
    ).toBe(403);
  });

  it('a CONTENT supervisor who is NOT an approved vet is rejected (403)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app); // plain user, not a vet
    await assignSystemSupervisor(app, admin.accessToken, user.id, 'CONTENT');
    expect(
      (await createContent(app, user.accessToken, { type: 'ARTICLE', title: 'x' })).status,
    ).toBe(403);
  });

  it('a spoofed creator / status in the body is rejected (422)', async () => {
    const admin = await registerAdmin(app);
    const res = await createContent(app, admin.accessToken, {
      type: 'ARTICLE',
      title: 'x',
      createdByUserId: admin.id,
      status: 'PUBLISHED',
    });
    expect(res.status).toBe(422);
  });

  it('unknown categoryIds are rejected (400)', async () => {
    const admin = await registerAdmin(app);
    const res = await createContent(app, admin.accessToken, {
      type: 'ARTICLE',
      title: 'x',
      categoryIds: ['00000000-0000-0000-0000-000000000000'],
    });
    expect(res.status).toBe(400);
  });
});

// --- public visibility ------------------------------------------

describe('content — public visibility', () => {
  async function seed() {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const mk = async (title: string): Promise<string> =>
      (await createContent(app, admin.accessToken, { type: 'ARTICLE', title })).body.data.id;
    const published = await mk('Published one');
    const draft = await mk('Draft one');
    const archived = await mk('Archived one');
    const deleted = await mk('Deleted one');
    await publishContent(app, admin.accessToken, published);
    await publishContent(app, admin.accessToken, archived);
    await archiveContent(app, admin.accessToken, archived);
    await publishContent(app, admin.accessToken, deleted);
    await request(app).delete(`/api/v1/admin/content/${deleted}`).set(bearer(admin.accessToken));
    return { admin, user, published, draft, archived, deleted };
  }

  it('lists only PUBLISHED, non-deleted content', async () => {
    const { user, published } = await seed();
    const res = await request(app).get('/api/v1/content').set(bearer(user.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([published]);
  });

  it('a user cannot GET a draft / archived / deleted item by id (404)', async () => {
    const { user, draft, archived, deleted } = await seed();
    for (const id of [draft, archived, deleted]) {
      expect(
        (await request(app).get(`/api/v1/content/${id}`).set(bearer(user.accessToken))).status,
      ).toBe(404);
    }
  });

  it('an admin / content supervisor sees every state through /admin/content', async () => {
    const { admin } = await seed();
    const res = await request(app)
      .get('/api/v1/admin/content?includeDeleted=true')
      .set(bearer(admin.accessToken));
    expect(res.body.meta.total).toBe(4);
    const sup = await registerContentSupervisor(app, admin.accessToken);
    const supRes = await request(app).get('/api/v1/admin/content').set(bearer(sup.accessToken));
    expect(supRes.status).toBe(200);
    expect(supRes.body.meta.total).toBe(3); // excludes the soft-deleted one by default
  });

  it('public file DTOs never expose the storage key', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const id = (await createContent(app, admin.accessToken, { type: 'BOOK', title: 'B' })).body.data
      .id;
    await uploadContentFile(app, container, admin.accessToken, id, {
      kind: 'MAIN',
      filename: 'b.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    });
    await publishContent(app, admin.accessToken, id);
    const res = await request(app).get(`/api/v1/content/${id}`).set(bearer(user.accessToken));
    expect(res.body.data.files).toHaveLength(1);
    expect(res.body.data.files[0]).not.toHaveProperty('storageKey');
    expect(res.body.data.files[0]).not.toHaveProperty('storageProvider');
  });
});

// --- lifecycle ------------------------------------------------

describe('content — lifecycle', () => {
  async function draft(): Promise<{ admin: { accessToken: string; id: string }; id: string }> {
    const admin = await registerAdmin(app);
    const id = (await createContent(app, admin.accessToken, { type: 'ARTICLE', title: 'L' })).body
      .data.id as string;
    return { admin, id };
  }

  it('publish then archive then re-publish; publishedAt is set once', async () => {
    const { admin, id } = await draft();
    const p1 = await publishContent(app, admin.accessToken, id);
    expect(p1.body.data.status).toBe('PUBLISHED');
    const firstPublishedAt = p1.body.data.publishedAt as string;
    expect(firstPublishedAt).not.toBeNull();

    const a = await archiveContent(app, admin.accessToken, id);
    expect(a.body.data.status).toBe('ARCHIVED');

    const p2 = await publishContent(app, admin.accessToken, id);
    expect(p2.body.data.status).toBe('PUBLISHED');
    expect(p2.body.data.publishedAt).toBe(firstPublishedAt); // unchanged
  });

  it('publish / archive are idempotent (repeated call → 200, same state)', async () => {
    const { admin, id } = await draft();
    await publishContent(app, admin.accessToken, id);
    const again = await publishContent(app, admin.accessToken, id);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('PUBLISHED');
    await archiveContent(app, admin.accessToken, id);
    expect((await archiveContent(app, admin.accessToken, id)).body.data.status).toBe('ARCHIVED');
  });

  it('a normal user cannot publish / archive / delete (403)', async () => {
    const { id } = await draft();
    const user = await registerUser(app);
    expect((await publishContent(app, user.accessToken, id)).status).toBe(403);
    expect((await archiveContent(app, user.accessToken, id)).status).toBe(403);
    expect(
      (await request(app).delete(`/api/v1/admin/content/${id}`).set(bearer(user.accessToken)))
        .status,
    ).toBe(403);
  });

  it('a CONTENT supervisor can publish but NOT delete (content.delete is ADMIN-only)', async () => {
    const { admin, id } = await draft();
    const sup = await registerContentSupervisor(app, admin.accessToken);
    expect((await publishContent(app, sup.accessToken, id)).status).toBe(200);
    expect(
      (await request(app).delete(`/api/v1/admin/content/${id}`).set(bearer(sup.accessToken)))
        .status,
    ).toBe(403);
  });

  it('soft-delete hides the item everywhere; restore brings it back; both idempotent', async () => {
    const { admin, id } = await draft();
    await publishContent(app, admin.accessToken, id);
    const del = await request(app)
      .delete(`/api/v1/admin/content/${id}`)
      .set(bearer(admin.accessToken));
    expect(del.body.data.deletedAt).not.toBeNull();
    expect(
      (await request(app).delete(`/api/v1/admin/content/${id}`).set(bearer(admin.accessToken)))
        .status,
    ).toBe(200);

    const user = await registerUser(app);
    expect(
      (await request(app).get(`/api/v1/content/${id}`).set(bearer(user.accessToken))).status,
    ).toBe(404);

    const restore = await request(app)
      .post(`/api/v1/admin/content/${id}/restore`)
      .set(bearer(admin.accessToken));
    expect(restore.body.data.deletedAt).toBeNull();
    expect(
      (await request(app).get(`/api/v1/content/${id}`).set(bearer(user.accessToken))).status,
    ).toBe(200);
  });

  it('a deactivated CONTENT supervisor loses access immediately', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerApprovedVet(app);
    const assign = await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: sup.id, domain: 'CONTENT' });
    const assignmentId = assign.body.data.id as string;

    expect(
      (await createContent(app, sup.accessToken, { type: 'ARTICLE', title: 'x' })).status,
    ).toBe(201);
    await request(app)
      .delete(`/api/v1/admin/supervisors/${assignmentId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(
      (await createContent(app, sup.accessToken, { type: 'ARTICLE', title: 'y' })).status,
    ).toBe(403);
  });
});

// --- articles & categories ----------------------------------

describe('content — articles & categories', () => {
  it('creates/updates an article with categories; enforces the body size cap', async () => {
    const admin = await registerAdmin(app);
    const cat1 = (await createCategory(app, admin.accessToken, { slug: 'pets', name: 'Pets' })).body
      .data.id as string;
    const cat2 = (
      await createCategory(app, admin.accessToken, { slug: 'surgery', name: 'Surgery' })
    ).body.data.id as string;

    const created = await createContent(app, admin.accessToken, {
      type: 'ARTICLE',
      title: 'Spay & neuter',
      body: 'Body text',
      categoryIds: [cat1],
    });
    expect(created.body.data.categories.map((c: { slug: string }) => c.slug)).toEqual(['pets']);

    const id = created.body.data.id as string;
    const updated = await request(app)
      .patch(`/api/v1/admin/content/${id}`)
      .set(bearer(admin.accessToken))
      .send({ title: 'Spay & neuter (rev 2)', categoryIds: [cat1, cat2] });
    expect(updated.body.data.title).toBe('Spay & neuter (rev 2)');
    expect(updated.body.data.categories.map((c: { slug: string }) => c.slug).sort()).toEqual([
      'pets',
      'surgery',
    ]);

    const tooBig = await request(app)
      .patch(`/api/v1/admin/content/${id}`)
      .set(bearer(admin.accessToken))
      .send({ body: 'x'.repeat(100_001) });
    expect(tooBig.status).toBe(422);
  });

  it('the article body is stored VERBATIM (the API does not interpret HTML)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const raw = '<script>alert(1)</script> plain text';
    const id = (
      await createContent(app, admin.accessToken, { type: 'ARTICLE', title: 'XSS', body: raw })
    ).body.data.id as string;
    await publishContent(app, admin.accessToken, id);
    const res = await request(app).get(`/api/v1/content/${id}`).set(bearer(user.accessToken));
    // stored + returned as-is; consumers must escape on render (documented)
    expect(res.body.data.body).toBe(raw);
  });

  it('rejects a duplicate category slug (409) and a bad slug (422)', async () => {
    const admin = await registerAdmin(app);
    await createCategory(app, admin.accessToken, { slug: 'poultry', name: 'Poultry' });
    expect(
      (await createCategory(app, admin.accessToken, { slug: 'poultry', name: 'Dup' })).status,
    ).toBe(409);
    expect(
      (await createCategory(app, admin.accessToken, { slug: 'Bad Slug', name: 'x' })).status,
    ).toBe(422);
  });

  it('a normal user cannot manage categories but can list them', async () => {
    const admin = await registerAdmin(app);
    await createCategory(app, admin.accessToken, { slug: 'general', name: 'General' });
    const user = await registerUser(app);
    expect((await createCategory(app, user.accessToken, { slug: 'x', name: 'x' })).status).toBe(
      403,
    );
    const list = await request(app).get('/api/v1/content-categories').set(bearer(user.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { slug: string }) => c.slug)).toContain('general');
  });
});

// --- books / magazines & files -----------------------------

describe('content — books / magazines & files', () => {
  async function book(): Promise<{ adminToken: string; id: string }> {
    const admin = await registerAdmin(app);
    const id = (await createContent(app, admin.accessToken, { type: 'BOOK', title: 'The Book' }))
      .body.data.id as string;
    return { adminToken: admin.accessToken, id };
  }

  it('presigned upload → register: the server owns the key, real size is recorded', async () => {
    const { adminToken, id } = await book();
    const urlRes = await request(app)
      .post(`/api/v1/admin/content/${id}/files/upload-url`)
      .set(bearer(adminToken))
      .send({ kind: 'MAIN', filename: 'book.pdf', mimeType: 'application/pdf', size: 5000 });
    expect(urlRes.status).toBe(201);
    const key = urlRes.body.data.storageKey as string;
    expect(key.startsWith('content/books/')).toBe(true);
    expect(urlRes.body.data.method).toBe('PUT');

    await storage.put(key, Buffer.alloc(1234, 7), { contentType: 'application/pdf' });

    const reg = await request(app)
      .post(`/api/v1/admin/content/${id}/files`)
      .set(bearer(adminToken))
      .send({ storageKey: key, kind: 'MAIN', filename: 'book.pdf', mimeType: 'application/pdf' });
    expect(reg.status).toBe(201);
    const file = reg.body.data.files[0];
    expect(file).toMatchObject({ kind: 'MAIN', mimeType: 'application/pdf', sizeBytes: 1234 });
    expect(file.storageKey).toBe(key); // admin DTO exposes it
    expect(events).toContain('content.file.uploaded');
  });

  it('rejects a disallowed MIME (400) and an oversized declared size (422)', async () => {
    const { adminToken, id } = await book();
    const bad = await request(app)
      .post(`/api/v1/admin/content/${id}/files/upload-url`)
      .set(bearer(adminToken))
      .send({ kind: 'MAIN', filename: 'x.txt', mimeType: 'text/plain', size: 10 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');

    const big = await request(app)
      .post(`/api/v1/admin/content/${id}/files/upload-url`)
      .set(bearer(adminToken))
      .send({ kind: 'MAIN', filename: 'x.pdf', mimeType: 'application/pdf', size: 999_999_999 });
    expect(big.status).toBe(422);
  });

  it('the client cannot register a key it fabricated (prefix mismatch → 409; unknown object → 400)', async () => {
    const { adminToken, id } = await book();
    const mismatch = await request(app)
      .post(`/api/v1/admin/content/${id}/files`)
      .set(bearer(adminToken))
      .send({
        storageKey: 'content/articles/2026/08/evil.pdf',
        kind: 'MAIN',
        filename: 'x.pdf',
        mimeType: 'application/pdf',
      });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('STORAGE_KEY_MISMATCH');

    const missing = await request(app)
      .post(`/api/v1/admin/content/${id}/files`)
      .set(bearer(adminToken))
      .send({
        storageKey: 'content/books/2026/08/never-uploaded.pdf',
        kind: 'MAIN',
        filename: 'x.pdf',
        mimeType: 'application/pdf',
      });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('STORAGE_OBJECT_MISSING');
  });

  it('replacing the MAIN file supersedes the old one and deletes its object', async () => {
    const { adminToken, id } = await book();
    const first = await uploadContentFile(app, container, adminToken, id, {
      kind: 'MAIN',
      filename: 'v1.pdf',
      mimeType: 'application/pdf',
      size: 100,
    });
    const firstKey = first.body.data.files[0].storageKey as string;
    expect(await storage.exists(firstKey)).toBe(true);

    events.length = 0;
    const second = await uploadContentFile(app, container, adminToken, id, {
      kind: 'MAIN',
      filename: 'v2.pdf',
      mimeType: 'application/pdf',
      size: 200,
    });
    expect(second.status).toBe(201);
    expect(second.body.data.files).toHaveLength(1); // only the new active MAIN
    expect(second.body.data.files[0].sizeBytes).toBe(200);
    expect(events).toContain('content.file.replaced');
    expect(await storage.exists(firstKey)).toBe(false); // old object cleaned up
  });

  it('deletes a file (soft row + storage object) idempotently', async () => {
    const { adminToken, id } = await book();
    const up = await uploadContentFile(app, container, adminToken, id, {
      kind: 'ATTACHMENT',
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      size: 50,
    });
    const fileId = up.body.data.files[0].id as string;
    const key = up.body.data.files[0].storageKey as string;

    const del = await request(app)
      .delete(`/api/v1/admin/content/${id}/files/${fileId}`)
      .set(bearer(adminToken));
    expect(del.status).toBe(200);
    expect(del.body.data.files).toHaveLength(0);
    expect(await storage.exists(key)).toBe(false);
    // idempotent
    expect(
      (
        await request(app)
          .delete(`/api/v1/admin/content/${id}/files/${fileId}`)
          .set(bearer(adminToken))
      ).status,
    ).toBe(200);
  });

  it('download URL: signed for the in-memory (private) backend; PUBLISHED gate on the public route', async () => {
    const { adminToken, id } = await book();
    const up = await uploadContentFile(app, container, adminToken, id, {
      kind: 'MAIN',
      filename: 'm.pdf',
      mimeType: 'application/pdf',
      size: 64,
    });
    const fileId = up.body.data.files[0].id as string;
    const user = await registerUser(app);

    // not published yet → public download route 404
    expect(
      (
        await request(app)
          .get(`/api/v1/content/${id}/files/${fileId}/download`)
          .set(bearer(user.accessToken))
      ).status,
    ).toBe(404);
    // admin download route works for any state
    const adminDl = await request(app)
      .get(`/api/v1/admin/content/${id}/files/${fileId}/download`)
      .set(bearer(adminToken));
    expect(adminDl.status).toBe(200);
    expect(adminDl.body.data.url).toMatch(/^memory:\/\//);
    expect(adminDl.body.data.expiresInSeconds).toBeGreaterThan(0);

    await publishContent(app, adminToken, id);
    const pub = await request(app)
      .get(`/api/v1/content/${id}/files/${fileId}/download`)
      .set(bearer(user.accessToken));
    expect(pub.status).toBe(200);
    expect(pub.body.data.url).toMatch(/^memory:\/\//);
  });
});

// --- storage failure handling (§28) ---------------------------

describe('content — storage failure handling', () => {
  it('a storage delete failure after commit does not roll back the DB (row still soft-deleted)', async () => {
    class FlakyStorage extends InMemoryObjectStorage {
      override delete(): Promise<void> {
        return Promise.reject(new Error('R2 unavailable'));
      }
    }
    const flaky = new FlakyStorage(null);
    const h = buildTestApp({ objectStorage: flaky });
    await resetDb();
    const admin = await registerAdmin(h.app);
    const id = (await createContent(h.app, admin.accessToken, { type: 'BOOK', title: 'F' })).body
      .data.id as string;
    const up = await uploadContentFile(h.app, h.container, admin.accessToken, id, {
      kind: 'MAIN',
      filename: 'f.pdf',
      mimeType: 'application/pdf',
      size: 10,
    });
    const fileId = up.body.data.files[0].id as string;

    const del = await request(h.app)
      .delete(`/api/v1/admin/content/${id}/files/${fileId}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(200); // storage error logged, not surfaced
    const row = await getTestDb()('content_files').where({ id: fileId }).first();
    expect(row.deleted_at).not.toBeNull();
  });
});

// --- search & pagination -------------------------------------

describe('content — search & pagination', () => {
  it('full-text search over title/description, type filter, and page limits', async () => {
    const admin = await registerAdmin(app);
    const mk = async (type: string, title: string, description?: string): Promise<string> => {
      const id = (await createContent(app, admin.accessToken, { type, title, description })).body
        .data.id as string;
      await publishContent(app, admin.accessToken, id);
      return id;
    };
    await mk('ARTICLE', 'Feline nutrition basics', 'diet and feeding');
    await mk('ARTICLE', 'Canine dental care', 'brushing teeth');
    const bookId = await mk('BOOK', 'Feline medicine reference');

    const user = await registerUser(app);
    const feline = await request(app).get('/api/v1/content?q=feline').set(bearer(user.accessToken));
    expect(feline.body.meta.total).toBe(2);

    const books = await request(app).get('/api/v1/content?type=BOOK').set(bearer(user.accessToken));
    expect(books.body.data.map((c: { id: string }) => c.id)).toEqual([bookId]);

    const page = await request(app)
      .get('/api/v1/content?pageSize=2&page=1')
      .set(bearer(user.accessToken));
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta.total).toBe(3);
  });

  it('category filter narrows the listing', async () => {
    const admin = await registerAdmin(app);
    const catId = (await createCategory(app, admin.accessToken, { slug: 'care', name: 'Care' }))
      .body.data.id as string;
    const a = (
      await createContent(app, admin.accessToken, {
        type: 'ARTICLE',
        title: 'A',
        categoryIds: [catId],
      })
    ).body.data.id as string;
    const b = (await createContent(app, admin.accessToken, { type: 'ARTICLE', title: 'B' })).body
      .data.id as string;
    await publishContent(app, admin.accessToken, a);
    await publishContent(app, admin.accessToken, b);

    const user = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/content?categoryId=${catId}`)
      .set(bearer(user.accessToken));
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([a]);
  });
});

// --- authorization / supervisor isolation -------------------

describe('content — authorization & supervisor isolation', () => {
  it('a Moderator (no CONTENT domain) cannot manage content', async () => {
    const mod = await registerModerator(app);
    expect(
      (await createContent(app, mod.accessToken, { type: 'ARTICLE', title: 'x' })).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/admin/content').set(bearer(mod.accessToken))).status,
    ).toBe(403);
  });

  it('an ANIMAL supervisor cannot manage content (wrong domain)', async () => {
    const admin = await registerAdmin(app);
    const animalSup = await registerApprovedVet(app);
    await assignSystemSupervisor(app, admin.accessToken, animalSup.id, 'ANIMAL');
    expect(
      (await createContent(app, animalSup.accessToken, { type: 'ARTICLE', title: 'x' })).status,
    ).toBe(403);
  });

  it('a CONTENT supervisor cannot reach unrelated admin domains (users / audit / supervisors / consultations)', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerContentSupervisor(app, admin.accessToken);
    expect(
      (await request(app).get('/api/v1/admin/users').set(bearer(sup.accessToken))).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/admin/audit-logs').set(bearer(sup.accessToken))).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/admin/consultations').set(bearer(sup.accessToken))).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/admin/supervisors')
          .set(bearer(sup.accessToken))
          .send({ userId: admin.id, domain: 'CONTENT' })
      ).status,
    ).toBe(403);
  });

  it('ADMIN retains full access via the override', async () => {
    const admin = await registerAdmin(app);
    const id = (await createContent(app, admin.accessToken, { type: 'MAGAZINE', title: 'M' })).body
      .data.id as string;
    expect((await publishContent(app, admin.accessToken, id)).status).toBe(200);
    expect(
      (await request(app).delete(`/api/v1/admin/content/${id}`).set(bearer(admin.accessToken)))
        .status,
    ).toBe(200);
  });
});

// --- audit --------------------------------------------------

describe('content — audit', () => {
  it('records CREATED / UPDATED / PUBLISHED / ARCHIVED / DELETED with the right actor and no secrets', async () => {
    const admin = await registerAdmin(app);
    const id = (
      await createContent(app, admin.accessToken, {
        type: 'ARTICLE',
        title: 'Audited',
        body: 'super secret body text',
      })
    ).body.data.id as string;
    await request(app)
      .patch(`/api/v1/admin/content/${id}`)
      .set(bearer(admin.accessToken))
      .send({ title: 'Audited v2' });
    await publishContent(app, admin.accessToken, id);
    await archiveContent(app, admin.accessToken, id);
    await request(app).delete(`/api/v1/admin/content/${id}`).set(bearer(admin.accessToken));

    const rows = await auditRows(id);
    expect(rows.map((r) => r.action)).toEqual([
      'CONTENT_CREATED',
      'CONTENT_UPDATED',
      'CONTENT_PUBLISHED',
      'CONTENT_ARCHIVED',
      'CONTENT_DELETED',
    ]);
    expect(rows.every((r) => r.actor_user_id === admin.id)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('super secret body text');
  });

  it('file-upload audit carries no storage key / URL', async () => {
    const admin = await registerAdmin(app);
    const id = (await createContent(app, admin.accessToken, { type: 'BOOK', title: 'AF' })).body
      .data.id as string;
    const up = await uploadContentFile(app, container, admin.accessToken, id, {
      kind: 'MAIN',
      filename: 'x.pdf',
      mimeType: 'application/pdf',
      size: 20,
    });
    const fileId = up.body.data.files[0].id as string;
    const key = up.body.data.files[0].storageKey as string;
    const rows = await auditRows(fileId);
    expect(rows.map((r) => r.action)).toEqual(['CONTENT_FILE_UPLOADED']);
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(JSON.stringify(rows)).not.toContain('memory://');
  });
});

// --- events -----------------------------------------------

describe('content — events', () => {
  it('emits after commit; a rejected create emits nothing', async () => {
    const admin = await registerAdmin(app);
    const id = (await createContent(app, admin.accessToken, { type: 'ARTICLE', title: 'E' })).body
      .data.id as string;
    await publishContent(app, admin.accessToken, id);
    await tick();
    expect(events).toEqual(['content.created', 'content.published']);

    events.length = 0;
    await createContent(app, admin.accessToken, {
      type: 'ARTICLE',
      title: 'x',
      status: 'PUBLISHED',
    }); // 422
    await tick();
    expect(events).toEqual([]);
  });
});
