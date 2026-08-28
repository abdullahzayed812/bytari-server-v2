import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AiResponderPort } from '../../src/modules/consultations/index.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { buildRealtimeHarness, TestWs, type RealtimeHarness } from '../helpers/realtime.js';
import {
  bearer,
  createConsultation,
  registerAdmin,
  registerSupportSupervisor,
  registerUser,
  sendThreadMessage,
} from '../helpers/factories.js';

class ThrowingAi implements AiResponderPort {
  generate(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

let harness: RealtimeHarness;

beforeAll(async () => {
  await ensureSchema();
  harness = await buildRealtimeHarness({ aiResponder: new ThrowingAi() });
});
beforeEach(async () => {
  await resetDb();
  await getTestDb()('ai_settings').update({ enabled: false });
});
afterAll(async () => {
  await harness.close();
  await closeTestDb();
});

async function scenario() {
  const app = harness.app;
  const admin = await registerAdmin(app);
  const owner = await registerUser(app);
  const outsider = await registerUser(app);
  const supervisor = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
  const c = await createConsultation(app, owner.accessToken, 'realtime please');
  return { app, admin, owner, outsider, supervisor, id: c.body.data.id as string };
}

describe('consultations realtime — subscription authorization', () => {
  it('the creator may subscribe to their consultation room', async () => {
    const { owner, id } = await scenario();
    const ws = await TestWs.connect(harness.wsUrl(owner.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `consultation:${id}` });
    expect((await ws.next('subscribed')).data.room).toBe(`consultation:${id}`);
    ws.close();
  });

  it('the responsible CONSULTATION supervisor may subscribe', async () => {
    const { supervisor, id } = await scenario();
    const ws = await TestWs.connect(harness.wsUrl(supervisor.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `consultation:${id}` });
    expect((await ws.next('subscribed')).data.room).toBe(`consultation:${id}`);
    ws.close();
  });

  it('an unrelated user is denied the consultation room', async () => {
    const { outsider, id } = await scenario();
    const ws = await TestWs.connect(harness.wsUrl(outsider.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `consultation:${id}` });
    expect(String((await ws.next('error')).data.message)).toMatch(/denied/i);
    ws.close();
  });

  it('an unauthenticated WebSocket connection is refused', async () => {
    await expect(TestWs.connect(harness.wsUrl())).rejects.toThrow(/401|unexpected-response/);
  });
});

describe('consultations realtime — message delivery', () => {
  it('delivers consultation.message.created (ids-only) to subscribers after commit; not to outsiders', async () => {
    const { app, owner, supervisor, outsider, id } = await scenario();

    const ownerWs = await TestWs.connect(harness.wsUrl(owner.accessToken));
    await ownerWs.next('welcome');
    ownerWs.send('subscribe', { room: `consultation:${id}` });
    await ownerWs.next('subscribed');

    const supWs = await TestWs.connect(harness.wsUrl(supervisor.accessToken));
    await supWs.next('welcome');
    supWs.send('subscribe', { room: `consultation:${id}` });
    await supWs.next('subscribed');

    const outWs = await TestWs.connect(harness.wsUrl(outsider.accessToken));
    await outWs.next('welcome');

    const res = await sendThreadMessage(app, owner.accessToken, 'consultations', id, 'ping ws');
    expect(res.status).toBe(201);
    const messageId = res.body.data.id as string;

    for (const ws of [ownerWs, supWs]) {
      const evt = await ws.next('consultation.message.created');
      expect(evt.data).toMatchObject({ consultationId: id, messageId, source: 'USER' });
      expect(JSON.stringify(evt.data)).not.toContain('ping ws');
    }
    await expect(outWs.next('consultation.message.created', 300)).rejects.toThrow(/timeout/);

    ownerWs.close();
    supWs.close();
    outWs.close();
  });

  it('a failed send to a CLOSED thread emits no message event', async () => {
    const { app, admin, owner, id } = await scenario();
    const ws = await TestWs.connect(harness.wsUrl(owner.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `consultation:${id}` });
    await ws.next('subscribed');

    await request(app)
      .post(`/api/v1/consultations/${id}/close`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const closed = await sendThreadMessage(
      app,
      owner.accessToken,
      'consultations',
      id,
      'after close',
    );
    expect(closed.status).toBe(409);

    await expect(ws.next('consultation.message.created', 300)).rejects.toThrow(/timeout/);
    // the close itself is delivered
    ws.close();
  });
});
