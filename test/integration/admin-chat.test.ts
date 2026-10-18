import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  sendChatMessage,
  startConversation,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('admin chat oversight — GET /admin/chat/conversations', () => {
  it('lists every conversation platform-wide for an admin, newest activity first', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Oversight Test Clinic',
    });
    const conversation = await startConversation(app, petOwner.accessToken, clinic.id);

    const res = await request(app)
      .get('/api/v1/admin/chat/conversations')
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(conversation.id);
  });

  it('rejects a caller without the chat.read oversight permission', async () => {
    const petOwner = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/admin/chat/conversations')
      .set(bearer(petOwner.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('admin chat oversight — read-only conversation viewer', () => {
  async function seedConversation() {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة الرقابة',
    });
    const conversation = await startConversation(app, petOwner.accessToken, clinic.id);
    for (const [token, body] of [
      [petOwner.accessToken, 'الرسالة الأولى'],
      [vetOwner.accessToken, 'الرسالة الثانية'],
      [petOwner.accessToken, 'الرسالة الثالثة'],
    ] as const) {
      expect((await sendChatMessage(app, token, conversation.id, body)).status).toBe(201);
    }
    return { admin, vetOwner, petOwner, clinic, conversation };
  }

  it('an admin who is NOT a participant reads details + messages oldest-first, paginated; the view is audited', async () => {
    const { admin, petOwner, clinic, conversation } = await seedConversation();
    const base = `/api/v1/admin/chat/conversations/${conversation.id}`;

    const details = await request(app).get(base).set(bearer(admin.accessToken));
    expect(details.status).toBe(200);
    expect(details.body.data).toMatchObject({
      id: conversation.id,
      type: 'PET_OWNER_CLINIC',
      organizationId: clinic.id,
      organizationName: 'عيادة الرقابة',
      petOwnerUserId: petOwner.id,
    });
    expect(
      (details.body.data.participants as { userId: string }[]).map((p) => p.userId),
    ).not.toContain(admin.id);

    const page1 = await request(app)
      .get(`${base}/messages?page=1&pageSize=2`)
      .set(bearer(admin.accessToken));
    expect(page1.status).toBe(200);
    expect(page1.body.meta.total).toBe(3);
    expect(page1.body.data.map((m: { body: string }) => m.body)).toEqual([
      'الرسالة الأولى',
      'الرسالة الثانية',
    ]);
    const page2 = await request(app)
      .get(`${base}/messages?page=2&pageSize=2`)
      .set(bearer(admin.accessToken));
    expect(page2.body.data.map((m: { body: string }) => m.body)).toEqual(['الرسالة الثالثة']);

    const audits = await getTestDb()('audit_logs').where({
      action: 'CHAT_CONVERSATION_VIEWED_BY_ADMIN',
      entity_id: conversation.id,
      actor_user_id: admin.id,
    });
    expect(audits).toHaveLength(1); // page 1 only

    // read-only: the admin did not become a participant, and still cannot use the user routes
    const parts = await getTestDb()('conversation_participants').where({
      conversation_id: conversation.id,
      user_id: admin.id,
    });
    expect(parts).toHaveLength(0);
  });

  it('ordinary users — even the participants — cannot use the admin viewer; unknown ids are 404', async () => {
    const { admin, petOwner, vetOwner, conversation } = await seedConversation();
    const base = `/api/v1/admin/chat/conversations/${conversation.id}`;
    for (const token of [petOwner.accessToken, vetOwner.accessToken]) {
      expect((await request(app).get(base).set(bearer(token))).status).toBe(403);
      expect((await request(app).get(`${base}/messages`).set(bearer(token))).status).toBe(403);
    }
    expect((await request(app).get(`${base}/messages`)).status).toBe(401);
    const missing = await request(app)
      .get('/api/v1/admin/chat/conversations/00000000-0000-4000-8000-000000000000/messages')
      .set(bearer(admin.accessToken));
    expect(missing.status).toBe(404);
    // there is no admin write route
    const post = await request(app)
      .post(`${base}/messages`)
      .set(bearer(admin.accessToken))
      .send({ body: 'x' });
    expect(post.status).toBe(404);
  });
});
