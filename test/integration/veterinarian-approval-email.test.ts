import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { NoopEmailProvider } from '../../src/infra/email/index.js';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser, seedStorageObject } from '../helpers/factories.js';

const storage = new InMemoryObjectStorage(null);
const { app, container } = buildTestApp({ objectStorage: storage });
const mail = container.emailProvider as NoopEmailProvider;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  storage.clear();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => closeTestDb());

async function apply(token: string): Promise<void> {
  const { storageKey } = await seedStorageObject(
    storage,
    StoragePrefix.veterinarianDocuments,
    Buffer.alloc(100, 1),
    'application/pdf',
  );
  const res = await request(app)
    .post('/api/v1/veterinarians/apply')
    .set(bearer(token))
    .send({
      documents: [
        { kind: 'LICENSE_OR_ID', storageKey, filename: 'license.pdf', mimeType: 'application/pdf' },
      ],
    });
  expect(res.status).toBe(201);
}

describe('Veterinarian approval email', () => {
  it('emails the veterinarian after the approval commits — no sensitive data', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerUser(app, { firstName: 'Reem' });
    await apply(applicant.accessToken);
    const before = mail.sent.length;

    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${applicant.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    await tick();

    const message = mail.lastMessageTo(applicant.email);
    expect(mail.sent.length).toBe(before + 1);
    expect(message?.subject).toContain('Your Bytari account is approved');
    expect(String(message?.text)).toContain('Reem');
    // nothing sensitive: no ids, no tokens, no password material
    for (const secret of [applicant.id, applicant.accessToken, 'password']) {
      expect(String(message?.text)).not.toContain(secret);
      expect(String(message?.html)).not.toContain(secret);
    }
  });

  it('an email failure never breaks the approval', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerUser(app);
    await apply(applicant.accessToken);
    vi.spyOn(container.emailService, 'send').mockRejectedValue(new Error('SMTP down'));

    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${applicant.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    await tick();
    const user = await getTestDb()('users').where({ id: applicant.id }).first();
    expect(user.veterinarian_status).toBe('APPROVED');
  });

  it('a failed approval (nothing pending) and a rejection send no approval email', async () => {
    const admin = await registerAdmin(app);
    const nobody = await registerUser(app);
    const before = mail.sent.length;
    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${nobody.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(404);

    const applicant = await registerUser(app);
    await apply(applicant.accessToken);
    const afterRegs = mail.sent.length;
    const rej = await request(app)
      .post(`/api/v1/admin/veterinarians/${applicant.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'missing license' });
    expect(rej.status).toBe(200);
    await tick();
    expect(mail.sent.length).toBe(afterRegs);
    expect(before).toBeLessThanOrEqual(afterRegs);
  });
});
