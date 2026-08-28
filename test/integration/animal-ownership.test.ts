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

describe('ownership transfer', () => {
  it('lets the current owner transfer to another active user', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: recipient.id, reason: 'moving abroad' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      ownerUserId: recipient.id,
      isCurrent: true,
      transferReason: 'moving abroad',
    });

    // history: old row closed, new row open — exactly one current
    const rows = await ownershipRows(animal.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ owner_user_id: owner.id });
    expect(rows[0]?.ended_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ owner_user_id: recipient.id, ended_at: null });
    const current = rows.filter((r) => r.ended_at === null);
    expect(current).toHaveLength(1);

    // the animal now belongs to the recipient
    const asRecipient = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(recipient.accessToken));
    expect(asRecipient.status).toBe(200);
    expect(asRecipient.body.data.currentOwnerUserId).toBe(recipient.id);

    // and no longer to the previous owner
    const asOldOwner = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(asOldOwner.status).toBe(404);
  });

  it('lets an ADMIN transfer any animal', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(admin.accessToken))
      .send({ toUserId: recipient.id });
    expect(res.status).toBe(200);
    expect(res.body.data.ownerUserId).toBe(recipient.id);
  });

  it('does not let a non-owner initiate a transfer (404, no state change)', async () => {
    const owner = await registerUser(app);
    const attacker = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(attacker.accessToken))
      .send({ toUserId: attacker.id });
    expect(res.status).toBe(404);

    const rows = await ownershipRows(animal.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_user_id: owner.id, ended_at: null });
  });

  it('ignores any ownership info in the request body — current owner comes from the server', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const stranger = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: recipient.id, currentOwnerId: stranger.id, fromUserId: stranger.id });
    expect(res.status).toBe(200);

    const rows = await ownershipRows(animal.id);
    expect(rows[0]?.owner_user_id).toBe(owner.id);
    expect(rows[1]?.owner_user_id).toBe(recipient.id);
  });

  it('rejects a transfer to an unknown user with 404', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: '00000000-0000-0000-0000-0000000000aa' });
    expect(res.status).toBe(404);
    expect(await ownershipRows(animal.id)).toHaveLength(1);
  });

  it('rejects a transfer to an inactive user with 400 INVALID_TRANSFER_TARGET', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    await getTestDb()('users').where({ id: recipient.id }).update({ status: 'SUSPENDED' });
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: recipient.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRANSFER_TARGET');
    expect(await ownershipRows(animal.id)).toHaveLength(1);
  });

  it('rejects a transfer to the current owner with 409 INVALID_TRANSFER_TARGET', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: owner.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSFER_TARGET');
    expect(await ownershipRows(animal.id)).toHaveLength(1);
  });

  it('rejects a transfer on a deactivated animal with 409 ANIMAL_NOT_ACTIVE (no partial records)', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    await request(app).delete(`/api/v1/animals/${animal.id}`).set(bearer(owner.accessToken));

    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/ownership/transfer`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: recipient.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ANIMAL_NOT_ACTIVE');

    const rows = await ownershipRows(animal.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_user_id: owner.id, ended_at: null });
  });

  it('keeps exactly one current owner across a chain of transfers', async () => {
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const u3 = await registerUser(app);
    const animal = await createAnimal(app, u1.accessToken);

    await transferAnimal(app, u1.accessToken, animal.id, u2.id);
    await transferAnimal(app, u2.accessToken, animal.id, u3.id);

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
    await transferAnimal(app, u1.accessToken, animal.id, u2.id, 'gift');

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
    await transferAnimal(app, u1.accessToken, animal.id, u2.id);

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
