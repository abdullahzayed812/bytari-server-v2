import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createFarm,
  createPoultryFlock,
  joinFarm,
  registerAdmin,
  registerApprovedVet,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

const captured: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('farm.') || e.name.startsWith('poultry.')) captured.push(e.name);
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  captured.length = 0;
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

describe('farm & poultry events + audit', () => {
  it('join by code → FARM_MEMBER_JOINED audit + farm.member.joined event after commit', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    captured.length = 0;

    const res = await joinFarm(app, vet.accessToken, farm.joinCode);
    await tick();

    expect(res.status).toBe(201);
    expect(captured).toContain('farm.member.joined');
    const rows = await auditRows(res.body.data.id as string);
    expect(rows.map((r) => r.action)).toContain('FARM_MEMBER_JOINED');
    const joined = rows.find((r) => r.action === 'FARM_MEMBER_JOINED');
    expect(joined?.actor_user_id).toBe(vet.id);
    expect(joined?.metadata).toMatchObject({
      organizationId: farm.id,
      userId: vet.id,
      roleKey: 'VETERINARIAN',
      via: 'join_code',
    });
  });

  it('an idempotent re-join emits no second event and writes no second audit row', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const first = await joinFarm(app, vet.accessToken, farm.joinCode);
    await tick();
    captured.length = 0;

    await joinFarm(app, vet.accessToken, farm.joinCode);
    await tick();

    expect(captured).not.toContain('farm.member.joined');
    const rows = await auditRows(first.body.data.id as string);
    expect(rows.filter((r) => r.action === 'FARM_MEMBER_JOINED')).toHaveLength(1);
  });

  it('regenerate → FARM_JOIN_CODE_REGENERATED audit + event, actor = owner', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    captured.length = 0;

    await request(app)
      .post(`/api/v1/organizations/${farm.id}/join-code/regenerate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await tick();

    expect(captured).toContain('farm.join_code.regenerated');
    const rows = await auditRows(farm.id);
    const regen = rows.find((r) => r.action === 'FARM_JOIN_CODE_REGENERATED');
    expect(regen?.actor_user_id).toBe(owner.id);
    expect(regen?.metadata).toMatchObject({ organizationId: farm.id });
  });

  it('poultry create/update/delete emit events and write audit with the acting vet', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    captured.length = 0;

    const flock = await createPoultryFlock(app, vet.accessToken, farm.id);
    await request(app)
      .patch(`/api/v1/organizations/${farm.id}/poultry/flocks/${flock.id}`)
      .set(bearer(vet.accessToken))
      .send({ birdCount: 42 });
    await request(app)
      .delete(`/api/v1/organizations/${farm.id}/poultry/flocks/${flock.id}`)
      .set(bearer(vet.accessToken));
    await tick();

    expect(captured).toEqual(
      expect.arrayContaining([
        'poultry.flock.created',
        'poultry.flock.updated',
        'poultry.flock.deleted',
      ]),
    );
    const rows = await auditRows(flock.id);
    expect(rows.map((r) => r.action)).toEqual([
      'POULTRY_FLOCK_CREATED',
      'POULTRY_FLOCK_UPDATED',
      'POULTRY_FLOCK_DELETED',
    ]);
    for (const r of rows) {
      expect(r.actor_user_id).toBe(vet.id);
      expect(r.metadata).toMatchObject({ organizationId: farm.id });
    }
  });

  it('a failed poultry create (non-FARM org) writes no audit and emits no event', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinicRes = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(owner.accessToken))
      .send({ type: 'CLINIC', name: 'Clinic' });
    const clinicId = clinicRes.body.data.id as string;
    await request(app)
      .post(`/api/v1/admin/organizations/${clinicId}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);
    captured.length = 0;

    const res = await request(app)
      .post(`/api/v1/organizations/${clinicId}/poultry/flocks`)
      .set(bearer(owner.accessToken))
      .send({ name: 'x', birdType: 'CHICKEN', birdCount: 1, arrivalDate: '2026-01-01' });
    await tick();

    expect(res.status).toBe(400);
    expect(captured).toHaveLength(0);
    const cnt = await getTestDb()('audit_logs')
      .where({ action: 'POULTRY_FLOCK_CREATED' })
      .count<{ count: string }>({ count: '*' })
      .first();
    expect(Number(cnt?.count ?? 0)).toBe(0);
  });

  it('does not leak secrets into farm/poultry audit metadata', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const res = await joinFarm(app, vet.accessToken, farm.joinCode);
    const blob = JSON.stringify(await auditRows(res.body.data.id as string));
    expect(blob.toLowerCase()).not.toContain('password');
    expect(blob).not.toContain(vet.accessToken);
  });
});
