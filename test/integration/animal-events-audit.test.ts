import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, createAnimal, registerUser } from '../helpers/factories.js';

const { app, container } = buildTestApp();

const captured: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('animal.')) captured.push(e.name);
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

describe('animal domain events + audit', () => {
  it('writes ANIMAL_CREATED and emits animal.created after commit', async () => {
    const user = await registerUser(app);
    const animal = await createAnimal(app, user.accessToken, { name: 'Scout' });
    await tick();

    expect(captured).toContain('animal.created');
    const rows = await auditRows(animal.id);
    expect(rows.map((r) => r.action)).toContain('ANIMAL_CREATED');
    const created = rows.find((r) => r.action === 'ANIMAL_CREATED');
    expect(created?.actor_user_id).toBe(user.id);
    expect(created?.metadata).toMatchObject({ name: 'Scout', species: 'DOG' });
  });

  it('writes ANIMAL_UPDATED / ANIMAL_DEACTIVATED with the acting owner', async () => {
    const user = await registerUser(app);
    const animal = await createAnimal(app, user.accessToken);

    await request(app)
      .patch(`/api/v1/animals/${animal.id}`)
      .set(bearer(user.accessToken))
      .send({ name: 'Renamed' });
    await request(app).delete(`/api/v1/animals/${animal.id}`).set(bearer(user.accessToken));
    await tick();

    expect(captured).toContain('animal.updated');
    expect(captured).toContain('animal.deactivated');
    const actions = (await auditRows(animal.id)).map((r) => r.action);
    expect(actions).toContain('ANIMAL_UPDATED');
    expect(actions).toContain('ANIMAL_DEACTIVATED');
  });

  it('writes ANIMAL_OWNERSHIP_TRANSFERRED with previous/new owner ids and emits the event', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: recipient.id, reason: 'rehomed' });
    await tick();

    expect(captured).toContain('animal.ownership.transferred');
    const transfer = (await auditRows(animal.id)).find(
      (r) => r.action === 'ANIMAL_OWNERSHIP_TRANSFERRED',
    );
    expect(transfer?.actor_user_id).toBe(owner.id);
    expect(transfer?.metadata).toMatchObject({
      animalId: animal.id,
      previousOwnerId: owner.id,
      newOwnerId: recipient.id,
      reason: 'rehomed',
    });
  });

  it('does not emit a success event or write audit when a transfer fails validation', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    captured.length = 0;

    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: owner.id }); // same owner → 409
    await tick();

    expect(res.status).toBe(409);
    expect(captured).not.toContain('animal.ownership.transferred');
    const actions = (await auditRows(animal.id)).map((r) => r.action);
    expect(actions).not.toContain('ANIMAL_OWNERSHIP_TRANSFERRED');
  });

  it('does not leak secrets into audit metadata', async () => {
    const user = await registerUser(app);
    const animal = await createAnimal(app, user.accessToken);
    const blob = JSON.stringify(await auditRows(animal.id));
    expect(blob).not.toContain(user.password);
    expect(blob.toLowerCase()).not.toContain('password');
    expect(blob).not.toContain(user.accessToken);
  });
});
