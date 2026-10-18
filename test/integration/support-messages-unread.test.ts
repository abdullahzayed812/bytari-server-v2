import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createSupportMessage,
  registerAdmin,
  registerSupportMessageSupervisor,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const unreadCount = async (token: string): Promise<number> => {
  const res = await request(app)
    .get(`${API}/admin/support-messages/unread-count`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data.count as number;
};
const openThread = (token: string, threadId: string) =>
  request(app).get(`${API}/support-messages/${threadId}/messages`).set(bearer(token));
const reply = (token: string, threadId: string, body: string) =>
  request(app)
    .post(`${API}/support-messages/${threadId}/messages`)
    .set(bearer(token))
    .send({ body });

describe('admin "رسائل المستخدمين" — new-message counter', () => {
  it('counts threads with unreviewed user messages; opening reviews them for the whole team; a new user reply re-flags', async () => {
    const admin = await registerAdmin(app);
    const supervisor = await registerSupportMessageSupervisor(app, admin.accessToken);
    const user = await registerUser(app);
    const other = await registerUser(app);

    const a = (await createSupportMessage(app, user.accessToken, 'مشكلة في الدفع')).body.data;
    const b = (await createSupportMessage(app, other.accessToken, 'سؤال عن الاشتراك')).body.data;
    expect(await unreadCount(admin.accessToken)).toBe(2);
    expect(await unreadCount(supervisor.accessToken)).toBe(2);

    // list rows carry the flag; `unread=true` filters to new ones only
    const list = await request(app)
      .get(`${API}/admin/support-messages`)
      .set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(
      (list.body.data as { id: string; responderUnread: boolean }[]).every(
        (t) => t.responderUnread,
      ),
    ).toBe(true);

    // the creator re-opening their own thread does not mark it reviewed
    expect((await openThread(user.accessToken, a.id)).status).toBe(200);
    expect(await unreadCount(admin.accessToken)).toBe(2);

    // a responder opening it reviews it for EVERY responder — opening twice never double-counts
    expect((await openThread(supervisor.accessToken, a.id)).status).toBe(200);
    expect((await openThread(admin.accessToken, a.id)).status).toBe(200);
    expect(await unreadCount(admin.accessToken)).toBe(1);
    expect(await unreadCount(supervisor.accessToken)).toBe(1);
    const onlyNew = await request(app)
      .get(`${API}/admin/support-messages?unread=true`)
      .set(bearer(admin.accessToken));
    expect((onlyNew.body.data as { id: string }[]).map((t) => t.id)).toEqual([b.id]);

    // the team's own reply does not re-flag it; the user's next message does
    expect((await reply(admin.accessToken, a.id, 'سنراجع الأمر')).status).toBe(201);
    expect(await unreadCount(admin.accessToken)).toBe(1);
    expect((await reply(user.accessToken, a.id, 'شكراً، ما زالت المشكلة')).status).toBe(201);
    expect(await unreadCount(admin.accessToken)).toBe(2);
    const row = (
      await request(app).get(`${API}/admin/support-messages`).set(bearer(admin.accessToken))
    ).body.data.find((t: { id: string }) => t.id === a.id);
    expect(row.responderUnread).toBe(true);
  });

  it('the counter is admin / SUPPORT-supervisor only', async () => {
    const user = await registerUser(app);
    await createSupportMessage(app, user.accessToken, 'مرحبا');
    const res = await request(app)
      .get(`${API}/admin/support-messages/unread-count`)
      .set(bearer(user.accessToken));
    expect(res.status).toBe(403);
    expect((await request(app).get(`${API}/admin/support-messages/unread-count`)).status).toBe(401);
  });
});
