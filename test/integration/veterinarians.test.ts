import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser, seedStorageObject } from '../helpers/factories.js';

const storage = new InMemoryObjectStorage(null);
const { app, container } = buildTestApp({ objectStorage: storage });

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  storage.clear();
});
afterAll(() => closeTestDb());

async function principalFor(token: string): Promise<{
  userId: string;
  email: string;
  status: string;
  veterinarianStatus: string;
  roleKeys: string[];
  sessionId: string | null;
}> {
  const verified = await container.tokenService.verifyAccessToken(token);
  const user = await container.userService.getById(verified.userId);
  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    veterinarianStatus: user.veterinarianStatus,
    roleKeys: await container.roleRepository.getRoleKeysForUser(user.id),
    sessionId: verified.sessionId,
  };
}

interface ApplyDocument {
  kind: 'LICENSE_OR_ID' | 'ADDITIONAL_ID' | 'STUDENT_ID_FRONT' | 'STUDENT_ID_BACK';
  storageKey: string;
  filename: string;
  mimeType: string;
}

async function seedDoc(
  kind: ApplyDocument['kind'],
  contentType = 'application/pdf',
): Promise<ApplyDocument> {
  const { storageKey } = await seedStorageObject(
    storage,
    StoragePrefix.veterinarianDocuments,
    Buffer.alloc(100, 1),
    contentType,
  );
  return { kind, storageKey, filename: `${kind.toLowerCase()}.pdf`, mimeType: contentType };
}

/** Seed a valid LICENSE_OR_ID document and apply as a VETERINARIAN (the default flow). */
async function applyAsVeterinarian(
  token: string,
  opts: { note?: string; extraDocs?: ApplyDocument[]; overrides?: Record<string, unknown> } = {},
): Promise<request.Response> {
  const license = await seedDoc('LICENSE_OR_ID');
  const documents = [license, ...(opts.extraDocs ?? [])];
  return request(app)
    .post('/api/v1/veterinarians/apply')
    .set(bearer(token))
    .send({
      ...(opts.note !== undefined ? { note: opts.note } : {}),
      documents,
      ...opts.overrides,
    });
}

describe('veterinarian approval workflow', () => {
  it('apply → PENDING, visible in the admin queue', async () => {
    const u = await registerUser(app);
    const apply = await applyAsVeterinarian(u.accessToken, { note: 'licensed 8 years' });
    expect(apply.status).toBe(201);
    expect(apply.body.data.status).toBe('PENDING');

    const status = await request(app)
      .get('/api/v1/veterinarians/me/status')
      .set(bearer(u.accessToken));
    expect(status.body.data.veterinarianStatus).toBe('PENDING');

    const admin = await registerAdmin(app);
    const pending = await request(app)
      .get('/api/v1/admin/veterinarians/pending')
      .set(bearer(admin.accessToken));
    expect(pending.body.data.map((a: { userId: string }) => a.userId)).toContain(u.id);
    const entry = pending.body.data.find((a: { userId: string }) => a.userId === u.id);
    expect(entry.subType).toBe('VETERINARIAN');
    expect(entry.documents).toHaveLength(1);
    expect(entry.documents[0].kind).toBe('LICENSE_OR_ID');
    expect(entry.documents[0].downloadUrl).toBeTypeOf('string');
    expect(entry.documents[0]).not.toHaveProperty('storageKey');
  });

  it('re-applying while PENDING is a 409', async () => {
    const u = await registerUser(app);
    await applyAsVeterinarian(u.accessToken);
    const again = await applyAsVeterinarian(u.accessToken);
    expect(again.status).toBe(409);
  });

  it('approval sets APPROVED, grants the VETERINARIAN role, and gates authz correctly', async () => {
    const u = await registerUser(app);
    await applyAsVeterinarian(u.accessToken);

    // before approval: not an approved vet
    const before = await principalFor(u.accessToken);
    expect(container.authorizationService.isApprovedVeterinarian(before)).toBe(false);
    expect(() => container.authorizationService.assertApprovedVeterinarian(before)).toThrow();

    const admin = await registerAdmin(app);
    const approve = await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');

    // after approval: role granted + status APPROVED + authz passes
    const after = await principalFor(u.accessToken);
    expect(after.roleKeys).toContain('VETERINARIAN');
    expect(after.veterinarianStatus).toBe('APPROVED');
    expect(container.authorizationService.isApprovedVeterinarian(after)).toBe(true);
    expect(() => container.authorizationService.assertApprovedVeterinarian(after)).not.toThrow();
  });

  it('a user who merely holds the VETERINARIAN role but is not APPROVED gets no vet access', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/admin/users/${u.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roleKey: 'VETERINARIAN' });

    const principal = await principalFor(u.accessToken);
    expect(principal.roleKeys).toContain('VETERINARIAN');
    expect(principal.veterinarianStatus).toBe('NOT_APPLIED');
    expect(container.authorizationService.isApprovedVeterinarian(principal)).toBe(false);
  });

  it('rejection sets REJECTED with a reason; the user may re-apply', async () => {
    const u = await registerUser(app);
    await applyAsVeterinarian(u.accessToken);
    const admin = await registerAdmin(app);

    const reject = await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'license could not be verified' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('REJECTED');
    expect(reject.body.data.decisionReason).toBe('license could not be verified');

    const status = await request(app)
      .get('/api/v1/veterinarians/me/status')
      .set(bearer(u.accessToken));
    expect(status.body.data.veterinarianStatus).toBe('REJECTED');

    // re-apply is allowed after rejection
    const reapply = await applyAsVeterinarian(u.accessToken, { note: 'attached updated license' });
    expect(reapply.status).toBe(201);
    expect(reapply.body.data.status).toBe('PENDING');
  });

  it('reject requires a reason (422)', async () => {
    const u = await registerUser(app);
    await applyAsVeterinarian(u.accessToken);
    const admin = await registerAdmin(app);
    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({});
    expect(res.status).toBe(422);
  });

  it('an admin cannot approve their own application', async () => {
    const admin = await registerAdmin(app);
    await applyAsVeterinarian(admin.accessToken);
    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${admin.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(403);
  });

  it('a non-privileged user cannot approve applications', async () => {
    const u = await registerUser(app);
    const other = await registerUser(app);
    await applyAsVeterinarian(u.accessToken);
    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/approve`)
      .set(bearer(other.accessToken));
    expect(res.status).toBe(403);
  });
});

// --- application sub-type & documents (mobile registration) --------

describe('veterinarian applications — sub-type & documents', () => {
  it('VETERINARIAN subType without a LICENSE_OR_ID document is rejected (422)', async () => {
    const u = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({ subType: 'VETERINARIAN', documents: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('STUDENT subType with only one of the two student-ID documents is rejected (422)', async () => {
    const u = await registerUser(app);
    const front = await seedDoc('STUDENT_ID_FRONT', 'image/png');
    const res = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({ subType: 'STUDENT', documents: [front] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a valid VETERINARIAN apply (license + optional additional ID) → 201, no storage keys leaked', async () => {
    const u = await registerUser(app);
    const additional = await seedDoc('ADDITIONAL_ID');
    const res = await applyAsVeterinarian(u.accessToken, { extraDocs: [additional] });
    expect(res.status).toBe(201);
    expect(res.body.data.subType).toBe('VETERINARIAN');
    expect(res.body.data.documents).toHaveLength(2);
    const kinds = res.body.data.documents.map((d: { kind: string }) => d.kind).sort();
    expect(kinds).toEqual(['ADDITIONAL_ID', 'LICENSE_OR_ID']);
    for (const doc of res.body.data.documents) {
      expect(doc).not.toHaveProperty('storageKey');
      expect(doc).not.toHaveProperty('storageProvider');
      expect(doc.mimeType).toBeTypeOf('string');
      expect(doc.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('a valid STUDENT apply with both student-ID sides → 201', async () => {
    const u = await registerUser(app);
    const front = await seedDoc('STUDENT_ID_FRONT', 'image/png');
    const back = await seedDoc('STUDENT_ID_BACK', 'image/png');
    const res = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({ subType: 'STUDENT', documents: [front, back] });
    expect(res.status).toBe(201);
    expect(res.body.data.subType).toBe('STUDENT');
    expect(res.body.data.documents.map((d: { kind: string }) => d.kind).sort()).toEqual([
      'STUDENT_ID_BACK',
      'STUDENT_ID_FRONT',
    ]);
  });

  it('POST /veterinarians/documents/upload-url issues a key under veterinarians/documents/', async () => {
    const u = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/veterinarians/documents/upload-url')
      .set(bearer(u.accessToken))
      .send({ kind: 'LICENSE_OR_ID', filename: 'license.pdf', mimeType: 'application/pdf', size: 1024 });
    expect(res.status).toBe(201);
    expect(res.body.data.storageKey.startsWith(`${StoragePrefix.veterinarianDocuments}/`)).toBe(
      true,
    );
    expect(res.body.data.method).toBe('PUT');
  });

  it('apply rejects a storage key stolen from a different prefix (409 STORAGE_KEY_MISMATCH)', async () => {
    const u = await registerUser(app);
    const stolen = await seedStorageObject(
      storage,
      'content/books',
      Buffer.alloc(10, 1),
      'application/pdf',
    );
    const res = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({
        documents: [
          {
            kind: 'LICENSE_OR_ID',
            storageKey: stolen.storageKey,
            filename: 'license.pdf',
            mimeType: 'application/pdf',
          },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STORAGE_KEY_MISMATCH');
  });

  it('apply rejects a document key that was never actually uploaded (400 STORAGE_OBJECT_MISSING)', async () => {
    const u = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({
        documents: [
          {
            kind: 'LICENSE_OR_ID',
            storageKey: `${StoragePrefix.veterinarianDocuments}/2026/08/never-uploaded.pdf`,
            filename: 'license.pdf',
            mimeType: 'application/pdf',
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STORAGE_OBJECT_MISSING');
  });

  it('apply re-validates the REAL mime/size from storage.head() over the client-declared values', async () => {
    const u = await registerUser(app);
    // Declares STUDENT_ID_FRONT (images only) but the real object is a PDF.
    const { storageKey } = await seedStorageObject(
      storage,
      StoragePrefix.veterinarianDocuments,
      Buffer.alloc(10, 1),
      'application/pdf',
    );
    const back = await seedDoc('STUDENT_ID_BACK', 'image/png');
    const res = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({
        subType: 'STUDENT',
        documents: [
          { kind: 'STUDENT_ID_FRONT', storageKey, filename: 'front.png', mimeType: 'image/png' },
          back,
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('privilege-escalation regression: client-supplied status/decidedBy/veterinarianStatus have zero effect', async () => {
    const u = await registerUser(app);
    const res = await applyAsVeterinarian(u.accessToken, {
      overrides: { status: 'APPROVED', decidedBy: u.id, veterinarianStatus: 'APPROVED' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.decidedBy).toBeNull();

    const row = await getTestDb()('users').where({ id: u.id }).first();
    expect(row.veterinarian_status).toBe('PENDING');
  });

  it('re-apply after REJECTED with a different subType/document set creates an independent application', async () => {
    const u = await registerUser(app);
    const admin = await registerAdmin(app);

    const first = await applyAsVeterinarian(u.accessToken);
    const firstAppId = first.body.data.id as string;
    await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'not verifiable' });

    const front = await seedDoc('STUDENT_ID_FRONT', 'image/png');
    const back = await seedDoc('STUDENT_ID_BACK', 'image/png');
    const second = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({ subType: 'STUDENT', documents: [front, back] });
    expect(second.status).toBe(201);
    const secondAppId = second.body.data.id as string;
    expect(secondAppId).not.toBe(firstAppId);
    expect(second.body.data.subType).toBe('STUDENT');

    // the old application's documents are untouched, still tied to the old id
    const oldDocs = await getTestDb()('veterinarian_application_documents').where({
      application_id: firstAppId,
    });
    expect(oldDocs).toHaveLength(1);
    expect(oldDocs[0].kind).toBe('LICENSE_OR_ID');

    const newDocs = await getTestDb()('veterinarian_application_documents').where({
      application_id: secondAppId,
    });
    expect(newDocs).toHaveLength(2);
  });
});
