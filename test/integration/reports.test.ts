import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function createRoom(adminToken: string) {
  const res = await request(app)
    .post('/api/v1/admin/chat-rooms')
    .set(bearer(adminToken))
    .send({ name: 'الدواجن', description: 'كل ما يخص الدواجن' });
  return res.body.data as { id: string; conversationId: string };
}

describe('Content reporting — submit / admin moderation queue', () => {
  it('a plain user reports a room; a non-admin cannot list or review it', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const reporter = await registerUser(app);

    const submit = await request(app)
      .post('/api/v1/reports')
      .set(bearer(reporter.accessToken))
      .send({ targetType: 'ROOM', targetId: room.id, reason: 'SPAM', details: 'إعلانات مزعجة' });
    expect(submit.status).toBe(201);
    expect(submit.body.data.status).toBe('PENDING');

    const listAsUser = await request(app)
      .get('/api/v1/admin/reports')
      .set(bearer(reporter.accessToken));
    expect(listAsUser.status).toBe(403);
  });

  it('reports a message; an admin lists and reviews it (PENDING → REVIEWED)', async () => {
    const admin = await registerAdmin(app);
    const room = await createRoom(admin.accessToken);
    const member = await registerUser(app);
    await request(app).post(`/api/v1/chat-rooms/${room.id}/join`).set(bearer(member.accessToken));

    const sent = await request(app)
      .post(`/api/v1/conversations/${room.conversationId}/messages`)
      .set(bearer(admin.accessToken))
      .send({ body: 'رسالة غير لائقة' });
    const messageId = sent.body.data.id as string;

    const submit = await request(app)
      .post('/api/v1/reports')
      .set(bearer(member.accessToken))
      .send({ targetType: 'MESSAGE', targetId: messageId, reason: 'INAPPROPRIATE_CONTENT' });
    expect(submit.status).toBe(201);
    const reportId = submit.body.data.id as string;

    const list = await request(app).get('/api/v1/admin/reports').set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(reportId);

    const review = await request(app)
      .patch(`/api/v1/admin/reports/${reportId}`)
      .set(bearer(admin.accessToken))
      .send({ status: 'REVIEWED' });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe('REVIEWED');
    expect(review.body.data.reviewedByUserId).toBe(admin.id);
  });

  it('rejects a report against a non-existent message with 404', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/reports')
      .set(bearer(user.accessToken))
      .send({ targetType: 'MESSAGE', targetId: '00000000-0000-0000-0000-000000000000', reason: 'OTHER' });
    expect(res.status).toBe(404);
  });
});
