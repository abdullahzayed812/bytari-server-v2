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

  it('registration (vet signup) and a PENDING application send no approval email; approval mails the registration email once', async () => {
    const admin = await registerAdmin(app);
    const email = `vet-signup-${Date.now()}@example.com`;
    const reg = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'correct-horse-battery-staple',
      firstName: 'Huda',
      lastName: 'Vet',
      phone: '+9647700000099',
      accountType: 'VETERINARIAN',
    });
    expect(reg.status).toBe(201);
    const userId = reg.body.data.user.id as string;
    await apply(reg.body.data.tokens.accessToken as string);
    await tick();
    const approvals = () =>
      mail.sent.filter(
        (m) =>
          (Array.isArray(m.to) ? m.to : [m.to]).includes(email) &&
          String(m.subject).includes('approved'),
      );
    expect(approvals()).toHaveLength(0); // pending → nothing

    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${userId}/approve`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    await tick();
    expect(approvals()).toHaveLength(1);
    expect(String(approvals()[0]?.text)).toContain('بيطري');
    const app1 = await getTestDb()('veterinarian_applications').where({ user_id: userId }).first();
    expect(app1.approval_email_sent_at).not.toBeNull();

    // Repeated admin action / duplicate event / retry sweep → still one email.
    const again = await request(app)
      .post(`/api/v1/admin/veterinarians/${userId}/approve`)
      .set(bearer(admin.accessToken));
    expect(again.status).toBe(404);
    const payload = { userId, applicationId: app1.id as string };
    container.eventBus.publish('veterinarian.approved', payload);
    container.eventBus.publish('veterinarian.approved', payload);
    await tick();
    expect(await container.veterinarianApprovalEmailHandler.retryPending()).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(approvals()).toHaveLength(1);
  });

  it('concurrent approvals commit once and send one email', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerUser(app);
    await apply(applicant.accessToken);
    const before = mail.sent.filter((m) => m.to === applicant.email).length;

    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/v1/admin/veterinarians/${applicant.id}/approve`)
        .set(bearer(admin.accessToken)),
      request(app)
        .post(`/api/v1/admin/veterinarians/${applicant.id}/approve`)
        .set(bearer(admin.accessToken)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    await tick();
    expect(mail.sent.filter((m) => m.to === applicant.email).length).toBe(before + 1);
    const audits = await getTestDb()('audit_logs').where({ action: 'VETERINARIAN_APPROVED' });
    expect(audits).toHaveLength(1);
  });

  it('a failed delivery is not marked sent and the retry sweep delivers it later', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerUser(app);
    await apply(applicant.accessToken);
    const send = vi
      .spyOn(container.emailService, 'send')
      .mockResolvedValueOnce({ success: false, provider: 'noop' });

    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${applicant.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    await tick();
    const row = await getTestDb()('veterinarian_applications')
      .where({ user_id: applicant.id })
      .first();
    expect(row.status).toBe('APPROVED');
    expect(row.approval_email_sent_at).toBeNull(); // released for retry
    send.mockRestore();

    const result = await container.veterinarianApprovalEmailHandler.retryPending();
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mail.lastMessageTo(applicant.email)?.subject).toContain('approved');
    const after = await getTestDb()('veterinarian_applications').where({ id: row.id }).first();
    expect(after.approval_email_sent_at).not.toBeNull();
    // Old approvals (outside the retry window) are never re-mailed.
    await getTestDb()('veterinarian_applications')
      .where({ id: row.id })
      .update({ approval_email_sent_at: null, decided_at: new Date('2020-01-01') });
    expect(await container.veterinarianApprovalEmailHandler.retryPending()).toEqual({
      sent: 0,
      failed: 0,
    });
  });
});
