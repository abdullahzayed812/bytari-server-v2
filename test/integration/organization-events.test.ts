import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

const captured: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('organization.')) captured.push(e.name);
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  captured.length = 0;
});
afterAll(() => closeTestDb());

async function auditActions(entityId?: string): Promise<string[]> {
  const q = getTestDb()('audit_logs')
    .orderBy('created_at', 'asc')
    .select('action', 'actor_user_id');
  if (entityId) q.where('entity_id', entityId);
  const rows = (await q) as Array<{ action: string; actor_user_id: string | null }>;
  return rows.map((r) => r.action);
}

describe('organization domain events + audit', () => {
  it('emits organization.created and writes ORGANIZATION_CREATED + member added', async () => {
    const vet = await registerApprovedVet(app);
    const org = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Org C' });
    await tick();

    expect(captured).toContain('organization.created');
    const actions = await auditActions(org.id);
    expect(actions).toContain('ORGANIZATION_CREATED');

    const memberAudit = (await getTestDb()('audit_logs')
      .where({ action: 'ORGANIZATION_MEMBER_ADDED' })
      .first()) as { actor_user_id: string; metadata: Record<string, unknown> };
    expect(memberAudit.actor_user_id).toBe(vet.id);
    expect(memberAudit.metadata).toMatchObject({ roleKey: 'OWNER', userId: vet.id });
  });

  it('emits approve / reject / suspend / activate events with the admin as audit actor', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);

    const a = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Org A' });
    await request(app)
      .post(`/api/v1/admin/organizations/${a.id}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/organizations/${a.id}/suspend`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/organizations/${a.id}/activate`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const b = await createOrganization(app, vet.accessToken, { type: 'FARM', name: 'Org B' });
    await request(app)
      .post(`/api/v1/admin/organizations/${b.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'rejected for testing' })
      .expect(200);
    await tick();

    expect(captured).toEqual(
      expect.arrayContaining([
        'organization.approved',
        'organization.suspended',
        'organization.activated',
        'organization.rejected',
      ]),
    );

    const approveRow = (await getTestDb()('audit_logs')
      .where({ action: 'ORGANIZATION_APPROVED', entity_id: a.id })
      .first()) as { actor_user_id: string };
    expect(approveRow.actor_user_id).toBe(admin.id);
  });

  it('emits member + supervisor events', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const supervisor = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'Org C' });
    await request(app)
      .post(`/api/v1/admin/organizations/${org.id}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);
    captured.length = 0;

    await request(app)
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: staff.id, role: 'STAFF' })
      .expect(201);
    const sup = await request(app)
      .post(`/api/v1/organizations/${org.id}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ userId: supervisor.id, permissions: ['member.read'] });
    await request(app)
      .delete(`/api/v1/organizations/${org.id}/supervisors/${sup.body.data.id as string}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await tick();

    expect(captured).toEqual(
      expect.arrayContaining([
        'organization.member.added',
        'organization.supervisor.assigned',
        'organization.supervisor.removed',
      ]),
    );
    const actions = await auditActions();
    expect(actions).toEqual(
      expect.arrayContaining([
        'ORGANIZATION_MEMBER_ADDED',
        'ORGANIZATION_SUPERVISOR_ASSIGNED',
        'ORGANIZATION_SUPERVISOR_REMOVED',
      ]),
    );
  });
});
