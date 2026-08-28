import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { buildRealtimeHarness, TestWs, type RealtimeHarness } from '../helpers/realtime.js';
import {
  bearer,
  createContent,
  registerAdmin,
  registerContentSupervisor,
  registerModerator,
  registerUser,
} from '../helpers/factories.js';

let harness: RealtimeHarness;

beforeAll(async () => {
  await ensureSchema();
  harness = await buildRealtimeHarness({ objectStorage: new InMemoryObjectStorage(null) });
});
beforeEach(() => resetDb());
afterAll(async () => {
  await harness.close();
  await closeTestDb();
});

describe('content realtime — content:feed authorization', () => {
  it('an admin may subscribe to content:feed', async () => {
    const admin = await registerAdmin(harness.app);
    const ws = await TestWs.connect(harness.wsUrl(admin.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: 'content:feed' });
    expect((await ws.next('subscribed')).data.room).toBe('content:feed');
    ws.close();
  });

  it('a CONTENT supervisor may subscribe; a plain user and a Moderator may not', async () => {
    const admin = await registerAdmin(harness.app);
    const sup = await registerContentSupervisor(harness.app, admin.accessToken);
    const user = await registerUser(harness.app);
    const mod = await registerModerator(harness.app);

    const supWs = await TestWs.connect(harness.wsUrl(sup.accessToken));
    await supWs.next('welcome');
    supWs.send('subscribe', { room: 'content:feed' });
    expect((await supWs.next('subscribed')).data.room).toBe('content:feed');
    supWs.close();

    for (const tok of [user.accessToken, mod.accessToken]) {
      const ws = await TestWs.connect(harness.wsUrl(tok));
      await ws.next('welcome');
      ws.send('subscribe', { room: 'content:feed' });
      expect(String((await ws.next('error')).data.message)).toMatch(/denied/i);
      ws.close();
    }
  });

  it('delivers content.* events (ids-only) to the feed after commit', async () => {
    const admin = await registerAdmin(harness.app);
    const ws = await TestWs.connect(harness.wsUrl(admin.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: 'content:feed' });
    await ws.next('subscribed');

    const res = await createContent(harness.app, admin.accessToken, {
      type: 'ARTICLE',
      title: 'Realtime article',
    });
    expect(res.status).toBe(201);
    const contentId = res.body.data.id as string;

    const evt = await ws.next('content.created');
    expect(evt.data).toMatchObject({ contentId, type: 'ARTICLE', status: 'DRAFT' });
    expect(JSON.stringify(evt.data)).not.toContain('Realtime article');

    await request(harness.app)
      .post(`/api/v1/admin/content/${contentId}/publish`)
      .set(bearer(admin.accessToken))
      .expect(200);
    const pub = await ws.next('content.published');
    expect(pub.data).toMatchObject({ contentId, status: 'PUBLISHED' });
    ws.close();
  });
});
