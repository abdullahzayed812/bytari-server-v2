import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser, seedStorageObject } from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function auditActions(filter: Record<string, string> = {}): Promise<string[]> {
  const rows = await getTestDb()('audit_logs')
    .where(filter)
    .orderBy('created_at', 'asc')
    .select('action');
  return (rows as Array<{ action: string }>).map((r) => r.action);
}

describe('audit log', () => {
  it('records the identity lifecycle of a self-registration', async () => {
    const u = await registerUser(app);
    const actions = await auditActions({ entity_id: u.id });
    expect(actions).toContain('USER_CREATED');
    expect(actions).toContain('ROLE_ASSIGNED');
  });

  it('records administrative actions with the admin as actor', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);

    await request(app)
      .post(`/api/v1/admin/users/${u.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'policy violation' })
      .expect(200);

    const row = (await getTestDb()('audit_logs')
      .where({ action: 'USER_SUSPENDED', entity_id: u.id })
      .first()) as {
      actor_user_id: string;
      metadata: Record<string, unknown>;
      request_id: string | null;
    };
    expect(row.actor_user_id).toBe(admin.id);
    expect(row.metadata).toMatchObject({ to: 'SUSPENDED', reason: 'policy violation' });
  });

  it('records the veterinarian approval chain', async () => {
    const u = await registerUser(app);
    const { storageKey } = await seedStorageObject(
      container.objectStorage,
      StoragePrefix.veterinarianDocuments,
      Buffer.alloc(100, 1),
      'application/pdf',
    );
    await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({
        documents: [
          {
            kind: 'LICENSE_OR_ID',
            storageKey,
            filename: 'license.pdf',
            mimeType: 'application/pdf',
          },
        ],
      });
    const admin = await registerAdmin(app);
    await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const all = await auditActions();
    expect(all).toEqual(
      expect.arrayContaining([
        'VETERINARIAN_APPLICATION_CREATED',
        'VETERINARIAN_APPROVED',
        'ROLE_ASSIGNED',
      ]),
    );
  });

  it('never stores passwords or tokens in metadata', async () => {
    await registerUser(app, {
      email: `leaky.${Date.now()}@test.bytari`,
      password: 'super-secret-value-123',
    });
    const rows = await getTestDb()('audit_logs').select('metadata');
    const dump = JSON.stringify(rows).toLowerCase();
    expect(dump).not.toContain('super-secret-value-123');
    expect(dump).not.toContain('password_hash');
    expect(dump).not.toContain('$argon2');
  });

  it('is exposed via GET /admin/audit-logs with filtering, newest first', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/admin/users/${u.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({})
      .expect(200);

    const res = await request(app)
      .get('/api/v1/admin/audit-logs?action=USER_SUSPENDED')
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].action).toBe('USER_SUSPENDED');
    expect(res.body.meta.total).toBe(1);
  });

  it("enriches each entry with the actor's name, and null for a system/no-actor entry", async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/admin/users/${u.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({})
      .expect(200);

    const res = await request(app)
      .get('/api/v1/admin/audit-logs?action=USER_SUSPENDED')
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    // `registerUser`/`registerAdmin` default to firstName 'Test', lastName 'User'.
    expect(res.body.data[0].actorName).toBe('Test User');

    // USER_CREATED on self-registration has no actor — actorName must be null, not a crash.
    const createdRes = await request(app)
      .get(`/api/v1/admin/audit-logs?action=USER_CREATED&entityId=${u.id}`)
      .set(bearer(admin.accessToken));
    expect(createdRes.status).toBe(200);
    expect(createdRes.body.data[0].actorUserId).toBeNull();
    expect(createdRes.body.data[0].actorName).toBeNull();
  });
});

describe('GET /admin/audit-logs/:id (details view)', () => {
  it('returns the full entry with actor, organization context and redacted metadata', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/admin/users/${u.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'policy violation' })
      .expect(200);
    const row = (await getTestDb()('audit_logs')
      .where({ action: 'USER_SUSPENDED', entity_id: u.id })
      .first('id')) as { id: string };

    const res = await request(app)
      .get(`/api/v1/admin/audit-logs/${row.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(res.body.data).toMatchObject({
      id: row.id,
      action: 'USER_SUSPENDED',
      entityType: 'USER',
      entityId: u.id,
      actorUserId: admin.id,
      actorExists: true,
      metadata: { to: 'SUSPENDED', reason: 'policy violation' },
      organization: null,
    });
    expect(typeof res.body.data.actorName).toBe('string');
    expect(typeof res.body.data.createdAt).toBe('string');
  });

  it('redacts credential-like metadata at any depth, also in the list', async () => {
    const admin = await registerAdmin(app);
    // An old / nested entry the shallow write-side filter would not catch.
    const [inserted] = (await getTestDb()('audit_logs')
      .insert({
        action: 'USER_UPDATED',
        entity_type: 'USER',
        metadata: {
          changes: { email: 'a@b.test', newPassword: 'hunter2', nested: [{ apiKey: 'k' }] },
          refreshTokenHash: 'abc',
          note: 'kept',
        },
      })
      .returning('id')) as Array<{ id: string }>;

    const res = await request(app)
      .get(`/api/v1/admin/audit-logs/${inserted!.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(res.body.data.metadata).toEqual({
      changes: { email: 'a@b.test', newPassword: '[redacted]', nested: [{ apiKey: '[redacted]' }] },
      refreshTokenHash: '[redacted]',
      note: 'kept',
    });
    expect(res.body.data.actorExists).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');

    const list = await request(app)
      .get('/api/v1/admin/audit-logs?action=USER_UPDATED')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('hunter2');
  });

  it('resolves the organization context from metadata', async () => {
    const admin = await registerAdmin(app);
    const [org] = (await getTestDb()('organizations')
      .insert({ name: 'Clinic Z', type: 'CLINIC', status: 'ACTIVE', owner_user_id: admin.id })
      .returning('id')) as Array<{ id: string }>;
    const [entry] = (await getTestDb()('audit_logs')
      .insert({
        action: 'VACCINATION_CREATED',
        entity_type: 'VACCINATION',
        actor_user_id: admin.id,
        metadata: { organizationId: org!.id },
      })
      .returning('id')) as Array<{ id: string }>;
    const res = await request(app)
      .get(`/api/v1/admin/audit-logs/${entry!.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(res.body.data.organization).toEqual({ id: org!.id, name: 'Clinic Z', type: 'CLINIC' });
  });

  it('is forbidden without audit.read and 404s for an unknown id', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    const [entry] = (await getTestDb()('audit_logs')
      .insert({ action: 'USER_UPDATED', entity_type: 'USER', metadata: {} })
      .returning('id')) as Array<{ id: string }>;
    await request(app)
      .get(`/api/v1/admin/audit-logs/${entry!.id}`)
      .set(bearer(u.accessToken))
      .expect(403);
    await request(app).get(`/api/v1/admin/audit-logs/${entry!.id}`).expect(401);
    await request(app)
      .get('/api/v1/admin/audit-logs/00000000-0000-4000-8000-000000000000')
      .set(bearer(admin.accessToken))
      .expect(404);
    await request(app)
      .get('/api/v1/admin/audit-logs/not-a-uuid')
      .set(bearer(admin.accessToken))
      .expect(422);
  });
});
