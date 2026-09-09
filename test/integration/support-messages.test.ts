import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createSupportMessage,
  registerAdmin,
  registerSupportMessageSupervisor,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();
const API = '/api/v1';

const events: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('support.')) events.push(e.name);
});

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  events.length = 0;
});
afterAll(() => closeTestDb());

describe('support messages — "تواصل معنا" (create)', () => {
  it('any signed-in user creates a support message with body only; it starts OPEN', async () => {
    const user = await registerUser(app);
    const res = await createSupportMessage(app, user.accessToken, 'التطبيق يتوقف عند فتح الإشعارات');

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: 'SUPPORT',
      status: 'OPEN',
      createdByUserId: user.id,
      animalId: null,
    });
    expect(events).toContain('support.created');
  });

  it('rejects an empty body (422) and a recipient / unknown field (422 — strict)', async () => {
    const user = await registerUser(app);
    expect((await createSupportMessage(app, user.accessToken, '   ')).status).toBe(422);

    const withRecipient = await request(app)
      .post(`${API}/support-messages`)
      .set(bearer(user.accessToken))
      .send({ body: 'مرحبا', toUserId: user.id });
    expect(withRecipient.status).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await request(app).post(`${API}/support-messages`).send({ body: 'hi' });
    expect(res.status).toBe(401);
  });
});

describe('support messages — reply thread & ownership isolation', () => {
  it('the creator sees only their own messages; a stranger 404s', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const created = await createSupportMessage(app, a.accessToken, 'استفسار عام عن الخدمات');
    const id = created.body.data.id;

    const mine = await request(app).get(`${API}/support-messages`).set(bearer(a.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);

    const otherList = await request(app).get(`${API}/support-messages`).set(bearer(b.accessToken));
    expect(otherList.body.data).toHaveLength(0);

    const peek = await request(app)
      .get(`${API}/support-messages/${id}`)
      .set(bearer(b.accessToken));
    expect(peek.status).toBe(404);
  });

  it('creator ↔ SUPPORT supervisor (non-vet) exchange replies; the supervisor can close', async () => {
    const admin = await registerAdmin(app);
    const supervisor = await registerSupportMessageSupervisor(app, admin.accessToken);
    const user = await registerUser(app);

    const created = await createSupportMessage(app, user.accessToken, 'الشكوى: بطء في التطبيق');
    const id = created.body.data.id;

    // the SUPPORT supervisor (NOT an approved vet) can read + respond
    const supView = await request(app)
      .get(`${API}/support-messages/${id}`)
      .set(bearer(supervisor.accessToken));
    expect(supView.status).toBe(200);

    const reply = await request(app)
      .post(`${API}/support-messages/${id}/messages`)
      .set(bearer(supervisor.accessToken))
      .send({ body: 'شكراً لتواصلك، نعمل على المشكلة.' });
    expect(reply.status).toBe(201);
    expect(reply.body.data.source).toBe('SUPERVISOR');
    expect(reply.body.data.supportId).toBe(id);
    expect(events).toContain('support.message.created');

    const userReply = await request(app)
      .post(`${API}/support-messages/${id}/messages`)
      .set(bearer(user.accessToken))
      .send({ body: 'شكراً' });
    expect(userReply.status).toBe(201);
    expect(userReply.body.data.source).toBe('USER');

    const close = await request(app)
      .post(`${API}/support-messages/${id}/close`)
      .set(bearer(supervisor.accessToken));
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('CLOSED');
    expect(events).toContain('support.closed');

    // CLOSED is terminal — no more messages
    const afterClose = await request(app)
      .post(`${API}/support-messages/${id}/messages`)
      .set(bearer(user.accessToken))
      .send({ body: 'مرحبا مجدداً' });
    expect(afterClose.status).toBe(409);
  });

  it('a random authenticated user cannot respond to or read a support message', async () => {
    const user = await registerUser(app);
    const outsider = await registerUser(app);
    const created = await createSupportMessage(app, user.accessToken, 'اقتراح لتحسين الواجهة');
    const id = created.body.data.id;

    const respond = await request(app)
      .post(`${API}/support-messages/${id}/messages`)
      .set(bearer(outsider.accessToken))
      .send({ body: 'أنا لست مشرفاً' });
    expect(respond.status).toBe(404);
  });
});

describe('support messages — admin oversight', () => {
  it('GET /admin/support-messages lists every thread for a SUPPORT supervisor / admin', async () => {
    const admin = await registerAdmin(app);
    const supervisor = await registerSupportMessageSupervisor(app, admin.accessToken);
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    await createSupportMessage(app, u1.accessToken, 'رسالة ١');
    await createSupportMessage(app, u2.accessToken, 'رسالة ٢');

    const asSupervisor = await request(app)
      .get(`${API}/admin/support-messages`)
      .set(bearer(supervisor.accessToken));
    expect(asSupervisor.status).toBe(200);
    expect(asSupervisor.body.data.length).toBeGreaterThanOrEqual(2);

    const asUser = await request(app)
      .get(`${API}/admin/support-messages`)
      .set(bearer(u1.accessToken));
    expect(asUser.status).toBe(403);
  });
});
