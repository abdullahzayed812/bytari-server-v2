import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('animal creation', () => {
  it('lets any authenticated user create an animal and become its owner', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/animals')
      .set(bearer(user.accessToken))
      .send({ name: 'Bella', species: 'DOG', breed: 'Beagle', sex: 'FEMALE' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Bella',
      species: 'DOG',
      breed: 'Beagle',
      sex: 'FEMALE',
      status: 'ACTIVE',
      createdBy: user.id,
      currentOwnerUserId: user.id,
    });

    // exactly one open ownership row, pointing at the creator
    const rows = (await getTestDb()('animal_ownerships')
      .where({ animal_id: res.body.data.id })
      .select('owner_user_id', 'ended_at')) as Array<{
      owner_user_id: string;
      ended_at: Date | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_user_id: user.id, ended_at: null });
  });

  it('ignores client-supplied owner / status / system fields', async () => {
    const attacker = await registerUser(app);
    const victim = await registerUser(app);

    const res = await request(app).post('/api/v1/animals').set(bearer(attacker.accessToken)).send({
      name: 'Ghost',
      species: 'CAT',
      ownerId: victim.id,
      ownerUserId: victim.id,
      ownershipId: '00000000-0000-0000-0000-000000000000',
      status: 'DEACTIVATED',
      createdBy: victim.id,
      id: '00000000-0000-0000-0000-000000000001',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.createdBy).toBe(attacker.id);
    expect(res.body.data.currentOwnerUserId).toBe(attacker.id);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.id).not.toBe('00000000-0000-0000-0000-000000000001');
  });

  it('rejects an unauthenticated create with 401', async () => {
    const res = await request(app).post('/api/v1/animals').send({ name: 'Nobody', species: 'DOG' });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid species / missing name with 422', async () => {
    const user = await registerUser(app);
    const bad1 = await request(app)
      .post('/api/v1/animals')
      .set(bearer(user.accessToken))
      .send({ name: 'X', species: 'DRAGON' });
    expect(bad1.status).toBe(422);

    const bad2 = await request(app)
      .post('/api/v1/animals')
      .set(bearer(user.accessToken))
      .send({ species: 'DOG' });
    expect(bad2.status).toBe(422);
  });

  it('rejects a future date of birth with 422', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/animals')
      .set(bearer(user.accessToken))
      .send({ name: 'TimeTraveller', species: 'DOG', dateOfBirth: '2999-01-01' });
    expect(res.status).toBe(422);
  });
});

describe('animal read', () => {
  it('lets the owner read their own animal', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken, { name: 'Rex' });
    const res = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: animal.id, currentOwnerUserId: owner.id });
  });

  it('hides another user’s animal as 404 (not 403)', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(other.accessToken));
    expect(res.status).toBe(404);
  });

  it('does not give an approved veterinarian access to someone else’s animal', async () => {
    const owner = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app).get(`/api/v1/animals/${animal.id}`).set(bearer(vet.accessToken));
    expect(res.status).toBe(404);
  });

  it('lets an ADMIN read any animal', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.currentOwnerUserId).toBe(owner.id);
  });

  it('returns 404 for an unknown animal id', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/animals/00000000-0000-0000-0000-0000000000ff')
      .set(bearer(user.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('animal list (owner-scoped)', () => {
  it('returns only the caller’s currently-owned animals', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await createAnimal(app, a.accessToken, { name: 'A1' });
    await createAnimal(app, a.accessToken, { name: 'A2' });
    await createAnimal(app, b.accessToken, { name: 'B1' });

    const res = await request(app).get('/api/v1/animals').set(bearer(a.accessToken));
    expect(res.status).toBe(200);
    const names = (res.body.data as Array<{ name: string }>).map((x) => x.name).sort();
    expect(names).toEqual(['A1', 'A2']);
    expect(res.body.meta.total).toBe(2);
  });

  it('does not let an ADMIN see other users’ animals through the collection route', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    await createAnimal(app, owner.accessToken);

    const res = await request(app).get('/api/v1/animals').set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('supports species + search filters', async () => {
    const u = await registerUser(app);
    await createAnimal(app, u.accessToken, { name: 'Whiskers', species: 'CAT' });
    await createAnimal(app, u.accessToken, { name: 'Fido', species: 'DOG' });

    const bySpecies = await request(app)
      .get('/api/v1/animals?species=CAT')
      .set(bearer(u.accessToken));
    expect((bySpecies.body.data as unknown[]).length).toBe(1);

    const bySearch = await request(app)
      .get('/api/v1/animals?search=fido')
      .set(bearer(u.accessToken));
    expect((bySearch.body.data as Array<{ name: string }>)[0]?.name).toBe('Fido');
  });
});

describe('animal update', () => {
  it('lets the owner update profile fields', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken, { name: 'Old' });

    const res = await request(app)
      .patch(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken))
      .send({ name: 'New', notes: 'friendly' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'New', notes: 'friendly' });
  });

  it('does not let PATCH change ownership or status (unknown fields ignored)', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken))
      .send({
        name: 'Renamed',
        currentOwnerUserId: other.id,
        ownerId: other.id,
        status: 'DEACTIVATED',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.currentOwnerUserId).toBe(owner.id);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('rejects a cross-user update as 404', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/animals/${animal.id}`)
      .set(bearer(other.accessToken))
      .send({ name: 'Hacked' });
    expect(res.status).toBe(404);
  });

  it('rejects an empty PATCH body with 422', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .patch(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken))
      .send({});
    expect(res.status).toBe(422);
  });

  it('rejects updates to a deactivated animal with 409 ANIMAL_NOT_ACTIVE', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    await request(app).delete(`/api/v1/animals/${animal.id}`).set(bearer(owner.accessToken));

    const res = await request(app)
      .patch(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken))
      .send({ name: 'Nope' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ANIMAL_NOT_ACTIVE');
  });
});

describe('animal deactivation', () => {
  it('soft-deletes and is idempotent, preserving ownership history', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const first = await request(app)
      .delete(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('DEACTIVATED');

    const second = await request(app)
      .delete(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('DEACTIVATED');

    // owner can still read it, and the ownership row is intact
    const read = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(read.status).toBe(200);
    const owns = await getTestDb()('animal_ownerships').where({ animal_id: animal.id });
    expect(owns).toHaveLength(1);
  });

  it('rejects a cross-user deactivation as 404', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .delete(`/api/v1/animals/${animal.id}`)
      .set(bearer(other.accessToken));
    expect(res.status).toBe(404);
  });

  it('lets an ADMIN deactivate any animal', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .delete(`/api/v1/animals/${animal.id}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DEACTIVATED');
  });
});

describe('animal DTO safety', () => {
  it('never exposes internal ownership rows or password hashes', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('passwordHash');
    expect(res.body.data).not.toHaveProperty('deactivatedAt');
  });
});
