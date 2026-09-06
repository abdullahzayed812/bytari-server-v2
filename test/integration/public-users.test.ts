import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerApprovedVet, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('GET /users/:id — authenticated name summary', () => {
  it('requires authentication', async () => {
    const target = await registerUser(app);
    const res = await request(app).get(`/api/v1/users/${target.id}`);
    expect(res.status).toBe(401);
  });

  it('returns only the name-level summary for an authenticated caller', async () => {
    const caller = await registerUser(app);
    const target = await registerUser(app, { firstName: 'Mona', lastName: 'Adel' });

    const res = await request(app)
      .get(`/api/v1/users/${target.id}`)
      .set(bearer(caller.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: target.id,
      firstName: 'Mona',
      lastName: 'Adel',
      veterinarianStatus: 'NOT_APPLIED',
      traderStatus: 'NOT_REGISTERED',
    });
    // never leak sensitive / internal fields
    for (const field of [
      'email',
      'phone',
      'status',
      'passwordHash',
      'password_hash',
      'roles',
      'permissions',
      'createdAt',
      'updatedAt',
    ]) {
      expect(res.body.data).not.toHaveProperty(field);
    }
  });

  it('reflects an approved veterinarian’s status', async () => {
    const caller = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const res = await request(app).get(`/api/v1/users/${vet.id}`).set(bearer(caller.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.veterinarianStatus).toBe('APPROVED');
  });

  it('404s an unknown id', async () => {
    const caller = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
      .set(bearer(caller.accessToken));
    expect(res.status).toBe(404);
  });

  it('422s a non-uuid id', async () => {
    const caller = await registerUser(app);
    const res = await request(app).get('/api/v1/users/not-a-uuid').set(bearer(caller.accessToken));
    expect(res.status).toBe(422);
  });

  it('treats a DEACTIVATED account as absent', async () => {
    const caller = await registerUser(app);
    const target = await registerUser(app);
    await getTestDb()('users').where({ id: target.id }).update({ status: 'DEACTIVATED' });

    const res = await request(app)
      .get(`/api/v1/users/${target.id}`)
      .set(bearer(caller.accessToken));
    expect(res.status).toBe(404);
  });
});
