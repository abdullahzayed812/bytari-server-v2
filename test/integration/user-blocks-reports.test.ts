import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createAnimal,
  createAnimalPublication,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  sendChatMessage,
  startConversation,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('user blocks (/users/me/blocks)', () => {
  it('block → direct messages refused both ways; unblock restores messaging', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic B',
    });
    const owner = await registerUser(app);
    const conv = await startConversation(app, owner.accessToken, clinic.id);
    expect((await sendChatMessage(app, owner.accessToken, conv.id, 'hello')).status).toBe(201);
    expect((await sendChatMessage(app, vet.accessToken, conv.id, 'hi back')).status).toBe(201);

    await request(app)
      .put(`${API}/users/me/blocks/${vet.id}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    const list = await request(app)
      .get(`${API}/users/me/blocks`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(list.body.data.map((b: { userId: string }) => b.userId)).toEqual([vet.id]);

    const mine = await sendChatMessage(app, owner.accessToken, conv.id, 'again');
    expect(mine.status).toBe(403);
    expect(mine.body.error.code).toBe('USER_BLOCKED');
    const theirs = await sendChatMessage(app, vet.accessToken, conv.id, 'again');
    expect(theirs.status).toBe(403);

    await request(app)
      .delete(`${API}/users/me/blocks/${vet.id}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect((await sendChatMessage(app, owner.accessToken, conv.id, 'ok')).status).toBe(201);
  });

  it('cannot block yourself or an unknown user', async () => {
    const owner = await registerUser(app);
    await request(app)
      .put(`${API}/users/me/blocks/${owner.id}`)
      .set(bearer(owner.accessToken))
      .expect(400);
    await request(app)
      .put(`${API}/users/me/blocks/00000000-0000-4000-8000-000000000123`)
      .set(bearer(owner.accessToken))
      .expect(404);
  });
});

describe('POST /reports — extended targets', () => {
  it('reports a user, a listing and an AI answer; unknown targets are 404', async () => {
    const reporter = await registerUser(app);
    const other = await registerUser(app);
    const pet = await createAnimal(app, other.accessToken, { name: 'Rex' });
    const pub = await createAnimalPublication(app, other.accessToken, pet.id, { kind: 'ADOPTION' });

    const submit = (targetType: string, targetId: string) =>
      request(app)
        .post(`${API}/reports`)
        .set(bearer(reporter.accessToken))
        .send({ targetType, targetId, reason: 'INAPPROPRIATE_CONTENT' });

    expect((await submit('USER', other.id)).status).toBe(201);
    expect((await submit('ANIMAL_PUBLICATION', pub.id)).status).toBe(201);

    const db = getTestDb();
    const [thread] = await db('consultations')
      .insert({ created_by_user_id: reporter.id, status: 'OPEN', last_message_at: db.fn.now() })
      .returning('id');
    const [ai] = await db('consultation_messages')
      .insert({ thread_id: thread.id, source: 'AI', body: 'answer' })
      .returning('id');
    expect((await submit('AI_MESSAGE', ai.id)).status).toBe(201);
    expect((await submit('AI_MESSAGE', '00000000-0000-4000-8000-000000000999')).status).toBe(404);
    expect(
      (await submit('ORGANIZATION_REVIEW', '00000000-0000-4000-8000-000000000999')).status,
    ).toBe(404);
  });
});
