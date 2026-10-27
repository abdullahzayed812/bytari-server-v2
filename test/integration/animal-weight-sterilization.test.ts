import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/**
 * Weight and sterilization status entered by the owner when REGISTERING an
 * animal must be stored and returned — `POST /animals` validated both fields
 * but used to drop them before they reached the database.
 */
describe('animal weight + sterilization status', () => {
  it('values given at registration are persisted and returned on read', async () => {
    const owner = await registerUser(app);
    const created = await request(app)
      .post('/api/v1/animals')
      .set(bearer(owner.accessToken))
      .send({ name: 'Mishmish', species: 'CAT', weightKg: 4.25, isNeutered: false });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ weightKg: 4.25, isNeutered: false });

    const row = await getTestDb()('animals').where({ id: created.body.data.id }).first();
    expect(Number(row.weight_kg)).toBe(4.25);
    expect(row.is_neutered).toBe(false);

    const read = await request(app)
      .get(`/api/v1/animals/${created.body.data.id}`)
      .set(bearer(owner.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ weightKg: 4.25, isNeutered: false });
  });

  it('not stating them leaves both null; an edit sets and clears them', async () => {
    const owner = await registerUser(app);
    const created = await request(app)
      .post('/api/v1/animals')
      .set(bearer(owner.accessToken))
      .send({ name: 'Rex', species: 'DOG' });
    expect(created.body.data).toMatchObject({ weightKg: null, isNeutered: null });
    const id = created.body.data.id as string;

    const set = await request(app)
      .patch(`/api/v1/animals/${id}`)
      .set(bearer(owner.accessToken))
      .send({ weightKg: 18, isNeutered: true });
    expect(set.body.data).toMatchObject({ weightKg: 18, isNeutered: true });

    const cleared = await request(app)
      .patch(`/api/v1/animals/${id}`)
      .set(bearer(owner.accessToken))
      .send({ weightKg: null, isNeutered: null });
    expect(cleared.body.data).toMatchObject({ weightKg: null, isNeutered: null });
  });

  it('rejects an invalid weight (422)', async () => {
    const owner = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/animals')
      .set(bearer(owner.accessToken))
      .send({ name: 'Bad', species: 'CAT', weightKg: -2 });
    expect(res.status).toBe(422);
  });
});
