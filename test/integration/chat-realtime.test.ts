import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { buildRealtimeHarness, TestWs, type RealtimeHarness } from '../helpers/realtime.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  startConversation,
} from '../helpers/factories.js';

let harness: RealtimeHarness;

beforeAll(async () => {
  await ensureSchema();
  harness = await buildRealtimeHarness();
});
beforeEach(() => resetDb());
afterAll(async () => {
  await harness.close();
  await closeTestDb();
});

async function clinicConversation() {
  const app = harness.app;
  const admin = await registerAdmin(app);
  const vetOwner = await registerApprovedVet(app);
  const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Realtime Clinic',
  });
  const petOwner = await registerUser(app);
  const outsider = await registerUser(app);
  const conv = await startConversation(app, petOwner.accessToken, clinic.id);
  return { app, admin, vetOwner, clinic, petOwner, outsider, conv };
}

describe('chat realtime — WebSocket authentication', () => {
  it('accepts a connection with a valid access token and sends welcome', async () => {
    const { petOwner } = await clinicConversation();
    const ws = await TestWs.connect(harness.wsUrl(petOwner.accessToken));
    const welcome = await ws.next('welcome');
    expect(welcome.data.userId).toBe(petOwner.id);
    ws.close();
  });

  it('refuses a connection with no token', async () => {
    await expect(TestWs.connect(harness.wsUrl())).rejects.toThrow(/401|unexpected-response/);
  });

  it('refuses a connection with a garbage token', async () => {
    await expect(TestWs.connect(harness.wsUrl('not-a-jwt'))).rejects.toThrow(
      /401|unexpected-response/,
    );
  });
});

describe('chat realtime — subscription authorization', () => {
  it('lets a participant subscribe to their conversation room', async () => {
    const { petOwner, conv } = await clinicConversation();
    const ws = await TestWs.connect(harness.wsUrl(petOwner.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `conversation:${conv.id}` });
    const ok = await ws.next('subscribed');
    expect(ok.data.room).toBe(`conversation:${conv.id}`);
    ws.close();
  });

  it('lets an ACTIVE clinic member subscribe to a clinic conversation room', async () => {
    const { vetOwner, conv } = await clinicConversation();
    const ws = await TestWs.connect(harness.wsUrl(vetOwner.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `conversation:${conv.id}` });
    expect((await ws.next('subscribed')).data.room).toBe(`conversation:${conv.id}`);
    ws.close();
  });

  it('denies subscribing to a conversation room the caller has no relationship to', async () => {
    const { outsider, conv } = await clinicConversation();
    const ws = await TestWs.connect(harness.wsUrl(outsider.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `conversation:${conv.id}` });
    const err = await ws.next('error');
    expect(String(err.data.message)).toMatch(/denied/i);
    ws.close();
  });

  it('denies subscribing to another user’s personal room', async () => {
    const { petOwner, outsider } = await clinicConversation();
    const ws = await TestWs.connect(harness.wsUrl(outsider.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `user:${petOwner.id}` });
    expect(String((await ws.next('error')).data.message)).toMatch(/denied/i);
    ws.close();
  });
});

describe('chat realtime — message delivery', () => {
  it('delivers chat.message.created (ids-only) to every subscribed participant after commit', async () => {
    const { app, vetOwner, petOwner, outsider, conv } = await clinicConversation();

    const ownerWs = await TestWs.connect(harness.wsUrl(petOwner.accessToken));
    await ownerWs.next('welcome');
    ownerWs.send('subscribe', { room: `conversation:${conv.id}` });
    await ownerWs.next('subscribed');

    const clinicWs = await TestWs.connect(harness.wsUrl(vetOwner.accessToken));
    await clinicWs.next('welcome');
    clinicWs.send('subscribe', { room: `conversation:${conv.id}` });
    await clinicWs.next('subscribed');

    // an outsider who somehow joined nothing must receive nothing
    const outWs = await TestWs.connect(harness.wsUrl(outsider.accessToken));
    await outWs.next('welcome');

    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/messages`)
      .set(bearer(petOwner.accessToken))
      .send({ body: 'ping over websocket' });
    expect(res.status).toBe(201);
    const messageId = res.body.data.id as string;

    for (const ws of [ownerWs, clinicWs]) {
      const evt = await ws.next('chat.message.created');
      expect(evt.data).toEqual({
        conversationId: conv.id,
        messageId,
        senderUserId: petOwner.id,
      });
      // no message body / secrets leak over the wire
      expect(JSON.stringify(evt.data)).not.toContain('ping over websocket');
    }

    await expect(outWs.next('chat.message.created', 300)).rejects.toThrow(/timeout/);

    ownerWs.close();
    clinicWs.close();
    outWs.close();
  });
});
