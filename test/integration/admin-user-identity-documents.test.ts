import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function applicantWithDocument() {
  const applicant = await registerUser(app);
  const [application] = await getTestDb()('veterinarian_applications')
    .insert({ user_id: applicant.id })
    .returning('id');
  await getTestDb()('veterinarian_application_documents').insert({
    application_id: (application as { id: string }).id,
    kind: 'LICENSE_OR_ID',
    storage_key: 'vet-documents/2026/09/id-card.jpg',
    storage_provider: 'memory',
    original_filename: 'id-card.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 2048,
  });
  return applicant;
}

describe('admin user details — identity documents (private, signed)', () => {
  it('an admin sees the documents as signed URLs; the storage key never leaks', async () => {
    const admin = await registerAdmin(app);
    const applicant = await applicantWithDocument();
    const res = await request(app)
      .get(`/api/v1/admin/users/${applicant.id}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    const app1 = res.body.data.veterinarianApplication;
    expect(app1.documentsVisible).toBe(true);
    expect(app1.documents).toHaveLength(1);
    expect(typeof app1.documents[0].downloadUrl).toBe('string');
    expect(app1.documents[0]).not.toHaveProperty('storageKey');
    // Never any password material on the admin user view.
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('a USERS supervisor (no veterinarian.read) gets metadata only, no document URLs', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await request(app)
      .put('/api/v1/admin/supervisors/domains')
      .set(bearer(admin.accessToken))
      .send({ userId: sup.id, domains: ['USERS'] });
    const applicant = await applicantWithDocument();
    const res = await request(app)
      .get(`/api/v1/admin/users/${applicant.id}`)
      .set(bearer(sup.accessToken));
    expect(res.status).toBe(200);
    const vetApp = res.body.data.veterinarianApplication;
    expect(vetApp.documentsVisible).toBe(false);
    expect(vetApp.documents[0]).not.toHaveProperty('downloadUrl');

    // A plain user cannot open another user's admin view at all.
    const plain = await registerUser(app);
    expect(
      (await request(app).get(`/api/v1/admin/users/${applicant.id}`).set(bearer(plain.accessToken)))
        .status,
    ).toBe(403);
  });
});
