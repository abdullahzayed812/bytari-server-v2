import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  registerAdmin,
  registerModerator,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const API = '/api/v1';

describe('system supervisor — assign by email', () => {
  it('assigns by email (case-insensitive); the assignment targets the resolved account', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    const res = await request(app)
      .post(`${API}/admin/supervisors`)
      .set(bearer(admin.accessToken))
      .send({ email: u.email.toUpperCase(), domain: 'CONTENT' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: u.id, domain: 'CONTENT', status: 'ACTIVE' });
  });

  it('invalid email 422; unknown email 404; both / neither identifier 422', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    const send = (body: Record<string, unknown>) =>
      request(app).post(`${API}/admin/supervisors`).set(bearer(admin.accessToken)).send(body);
    expect((await send({ email: 'not-an-email', domain: 'CONTENT' })).status).toBe(422);
    expect((await send({ email: 'nobody@example.com', domain: 'CONTENT' })).status).toBe(404);
    expect((await send({ email: u.email, userId: u.id, domain: 'CONTENT' })).status).toBe(422);
    expect((await send({ domain: 'CONTENT' })).status).toBe(422);
  });

  it('ineligible (suspended) account 409; self-assignment 403; non-admin 403', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post(`${API}/admin/users/${u.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({});
    const suspended = await request(app)
      .post(`${API}/admin/supervisors`)
      .set(bearer(admin.accessToken))
      .send({ email: u.email, domain: 'CONTENT' });
    expect(suspended.status).toBe(409);

    const self = await request(app)
      .post(`${API}/admin/supervisors`)
      .set(bearer(admin.accessToken))
      .send({ email: admin.email, domain: 'CONTENT' });
    expect(self.status).toBe(403);

    const mod = await registerModerator(app);
    const other = await registerUser(app);
    const denied = await request(app)
      .post(`${API}/admin/supervisors`)
      .set(bearer(mod.accessToken))
      .send({ email: other.email, domain: 'CONTENT' });
    expect(denied.status).toBe(403);
  });
});

describe('animal transfer request — recipient by email', () => {
  it('creates the request for the account owning that email', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .post(`${API}/animals/${animal.id}/transfer-requests`)
      .set(bearer(owner.accessToken))
      .send({ toEmail: recipient.email, reason: 'gift' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', toUser: { id: recipient.id } });
  });

  it('unknown email 404, own email 409, suspended recipient 400 — same rules as by id', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const suspended = await registerUser(app);
    await request(app)
      .post(`${API}/admin/users/${suspended.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({});
    const animal = await createAnimal(app, owner.accessToken);
    const send = (toEmail: string) =>
      request(app)
        .post(`${API}/animals/${animal.id}/transfer-requests`)
        .set(bearer(owner.accessToken))
        .send({ toEmail });
    expect((await send('ghost@example.com')).status).toBe(404);
    const self = await send(owner.email);
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('INVALID_TRANSFER_TARGET');
    const inactive = await send(suspended.email);
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.code).toBe('INVALID_TRANSFER_TARGET');
    expect((await send('bad-email')).status).toBe(422);
  });

  it('a non-owner cannot create a transfer by email (404)', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .post(`${API}/animals/${animal.id}/transfer-requests`)
      .set(bearer(stranger.accessToken))
      .send({ toEmail: stranger.email });
    expect(res.status).toBe(404);
  });
});
