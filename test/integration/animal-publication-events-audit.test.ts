import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  createAnimalPublication,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

const captured: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (
    e.name.startsWith('animal.lost.') ||
    e.name.startsWith('animal.adoption.') ||
    e.name.startsWith('animal.mating.')
  ) {
    captured.push(e.name);
  }
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

describe('animal-publication events + audit', () => {
  it('create → LOST_ANIMAL_CREATED audit (actor = owner) + animal.lost.created after commit', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });
    await tick();

    expect(captured).toContain('animal.lost.created');
    const rows = await auditRows(pub.id);
    expect(rows.map((r) => r.action)).toEqual(['LOST_ANIMAL_CREATED']);
    expect(rows[0]?.actor_user_id).toBe(owner.id);
    expect(rows[0]?.metadata).toMatchObject({
      animalId: animal.id,
      publicationId: pub.id,
      kind: 'LOST',
    });
  });

  it('approve / reject emit the kind-specific event and write audit with the moderator as actor', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const a1 = await createAnimal(app, owner.accessToken);
    const a2 = await createAnimal(app, owner.accessToken);
    const approved = await createAnimalPublication(app, owner.accessToken, a1.id, {
      kind: 'ADOPTION',
    });
    const rejected = await createAnimalPublication(app, owner.accessToken, a2.id, {
      kind: 'MATING',
    });
    captured.length = 0;

    await request(app)
      .post(`/api/v1/admin/animal-publications/${approved.id}/approve`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/animal-publications/${rejected.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'no' })
      .expect(200);
    await tick();

    expect(captured).toEqual(
      expect.arrayContaining(['animal.adoption.approved', 'animal.mating.rejected']),
    );

    const approvedAudit = await auditRows(approved.id);
    expect(approvedAudit.map((r) => r.action)).toEqual(['ADOPTION_CREATED', 'ADOPTION_APPROVED']);
    expect(approvedAudit[1]?.actor_user_id).toBe(admin.id);

    const rejectedAudit = await auditRows(rejected.id);
    expect(rejectedAudit.map((r) => r.action)).toEqual(['MATING_CREATED', 'MATING_REJECTED']);
    expect(rejectedAudit[1]?.metadata).toMatchObject({ kind: 'MATING', reason: 'no' });
  });

  it('a failed create (duplicate open publication) writes no extra audit and emits no event', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });
    captured.length = 0;

    const dup = await request(app)
      .post(`/api/v1/animals/${animal.id}/publications`)
      .set(bearer(owner.accessToken))
      .send({
        kind: 'LOST',
        contactName: 'Test Contact',
        contactPhone: '07701234567',
        lostDate: '2026-01-01',
        lostGovernorate: 'Baghdad',
        lostDistrict: 'Karrada',
      });
    await tick();

    expect(dup.status).toBe(409);
    expect(captured).toHaveLength(0);
    const cnt = await getTestDb()('audit_logs')
      .where({ action: 'LOST_ANIMAL_CREATED' })
      .count<{ count: string }>({ count: '*' })
      .first();
    expect(Number(cnt?.count ?? 0)).toBe(1);
  });

  it('does not leak secrets into publication audit metadata', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'LOST',
      note: 'contact me',
    });
    const blob = JSON.stringify(await auditRows(pub.id));
    expect(blob.toLowerCase()).not.toContain('password');
    expect(blob).not.toContain(owner.accessToken);
  });
});
