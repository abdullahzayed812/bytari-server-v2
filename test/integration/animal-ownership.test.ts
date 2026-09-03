import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  registerAdmin,
  registerUser,
  transferAnimal,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function ownershipRows(animalId: string): Promise<
  Array<{
    owner_user_id: string;
    started_at: Date;
    ended_at: Date | null;
    transferred_by: string | null;
  }>
> {
  return getTestDb()('animal_ownerships')
    .where({ animal_id: animalId })
    .orderBy('started_at', 'asc')
    .select('owner_user_id', 'started_at', 'ended_at', 'transferred_by');
}

/**
 * Ownership only ever moves via the request/acceptance workflow now — see
 * `animal-transfer-requests.test.ts` for the full create/accept/reject/cancel
 * validation matrix (self-target, inactive target, deactivated animal, ADMIN
 * override, non-owner protection, concurrency). This file covers what remains
 * endpoint-agnostic: the ownership ledger's own invariants, and the read-only
 * history endpoint.
 */
describe('ownership ledger invariants', () => {
  it('keeps exactly one current owner across a chain of transfers', async () => {
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const u3 = await registerUser(app);
    const animal = await createAnimal(app, u1.accessToken);

    await transferAnimal(app, u1.accessToken, animal.id, u2.id, u2.accessToken);
    await transferAnimal(app, u2.accessToken, animal.id, u3.id, u3.accessToken);

    const rows = await ownershipRows(animal.id);
    expect(rows.map((r) => r.owner_user_id)).toEqual([u1.id, u2.id, u3.id]);
    expect(rows.filter((r) => r.ended_at === null)).toHaveLength(1);
    expect(rows[2]?.owner_user_id).toBe(u3.id);
  });

  it('enforces one current ownership at the database level (partial unique index)', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    await expect(
      getTestDb()('animal_ownerships').insert({
        animal_id: animal.id,
        owner_user_id: owner.id,
      }),
    ).rejects.toThrow();
  });
});

describe('ownership history', () => {
  it('returns the full history oldest-first with one current record', async () => {
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const animal = await createAnimal(app, u1.accessToken);
    await transferAnimal(app, u1.accessToken, animal.id, u2.id, u2.accessToken, 'gift');

    const res = await request(app)
      .get(`/api/v1/animals/${animal.id}/ownership/history`)
      .set(bearer(u2.accessToken));
    expect(res.status).toBe(200);
    const history = res.body.data as Array<{
      ownerUserId: string;
      isCurrent: boolean;
      owner: { email: string } | null;
    }>;
    expect(history.map((h) => h.ownerUserId)).toEqual([u1.id, u2.id]);
    expect(history.filter((h) => h.isCurrent)).toHaveLength(1);
    expect(history[1]?.isCurrent).toBe(true);
    expect(history[0]?.owner?.email).toBe(u1.email);
  });

  it('hides the history of an animal the caller does not own (404)', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .get(`/api/v1/animals/${animal.id}/ownership/history`)
      .set(bearer(other.accessToken));
    expect(res.status).toBe(404);
  });

  it('lets a former owner see history only while they still own it', async () => {
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const animal = await createAnimal(app, u1.accessToken);
    await transferAnimal(app, u1.accessToken, animal.id, u2.id, u2.accessToken);

    const asFormer = await request(app)
      .get(`/api/v1/animals/${animal.id}/ownership/history`)
      .set(bearer(u1.accessToken));
    expect(asFormer.status).toBe(404);
  });

  it('lets an ADMIN read any animal’s history', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .get(`/api/v1/animals/${animal.id}/ownership/history`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
