import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createAnimal,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const delMe = (token: string, password: string) =>
  request(app).delete(`${API}/users/me`).set(bearer(token)).send({ password });

describe('DELETE /users/me — self-service account deletion', () => {
  it('deletes the caller account with the correct password and kills the session', async () => {
    const owner = await registerUser(app);
    await createAnimal(app, owner.accessToken, { name: 'Milo' });

    const res = await delMe(owner.accessToken, owner.password).expect(200);
    expect(res.body.data).toEqual({ id: owner.id, deleted: true });

    const db = getTestDb();
    expect(await db('users').where({ id: owner.id }).first()).toBeUndefined();
    await request(app).get(`${API}/auth/me`).set(bearer(owner.accessToken)).expect(401);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: owner.email, password: owner.password });
    expect(login.status).toBe(401);
    const audit = await db('audit_logs')
      .where({ action: 'USER_DELETED', entity_id: owner.id })
      .first();
    expect(audit.metadata.selfService).toBe(true);
  });

  it('rejects a wrong password with 400 INVALID_CURRENT_PASSWORD and keeps the account', async () => {
    const owner = await registerUser(app);
    const res = await delMe(owner.accessToken, 'wrong-password-1').expect(400);
    expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(await getTestDb()('users').where({ id: owner.id }).first()).toBeDefined();
  });

  it('blocks organization owners and admins with USER_DELETE_BLOCKED', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic A',
    });
    const ownerRes = await delMe(vet.accessToken, vet.password).expect(409);
    expect(ownerRes.body.error.code).toBe('USER_DELETE_BLOCKED');
    expect(ownerRes.body.error.details[0].rule).toBe('OWNS_ORGANIZATIONS');

    const adminRes = await delMe(admin.accessToken, admin.password).expect(409);
    expect(adminRes.body.error.details[0].rule).toBe('ADMIN_ACCOUNT');
  });

  it('requires authentication and a password', async () => {
    await request(app).delete(`${API}/users/me`).send({ password: 'x' }).expect(401);
    const owner = await registerUser(app);
    await request(app)
      .delete(`${API}/users/me`)
      .set(bearer(owner.accessToken))
      .send({})
      .expect(422);
  });
});
