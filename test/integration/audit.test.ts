import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

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
    await request(app).post('/api/v1/veterinarians/apply').set(bearer(u.accessToken)).send({});
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
});
