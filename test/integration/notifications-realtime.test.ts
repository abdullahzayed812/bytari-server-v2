import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { FakePushProvider } from '../helpers/fake-push-provider.js';
import { buildRealtimeHarness, TestWs, type RealtimeHarness } from '../helpers/realtime.js';
import {
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

let harness: RealtimeHarness;
const push = new FakePushProvider();

beforeAll(async () => {
  await ensureSchema();
  harness = await buildRealtimeHarness({ pushProvider: push });
});
beforeEach(async () => {
  await resetDb();
  push.reset();
});
afterAll(async () => {
  await harness.close();
  await closeTestDb();
});

describe('notifications realtime', () => {
  it("delivers notification.created (ids-only) to the recipient's own user room", async () => {
    const admin = await registerAdmin(harness.app);
    const owner = await registerApprovedVet(harness.app);

    const ws = await TestWs.connect(harness.wsUrl(owner.accessToken));
    const welcome = await ws.next('welcome');
    // the socket auto-joins its own user room
    expect((welcome.data.rooms as string[]).some((r) => r === `user:${owner.id}`)).toBe(true);

    await createActiveOrganization(harness.app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'RT Clinic',
    });

    const evt = await ws.next('notification.created', 3000);
    expect(evt.data).toMatchObject({ type: 'ORGANIZATION_APPROVED' });
    expect(evt.data).toHaveProperty('notificationId');
    // no title / body leaks over realtime
    expect(JSON.stringify(evt.data)).not.toMatch(/approved\./i);
    ws.close();
  });

  it("a user cannot subscribe to another user's notification room", async () => {
    const a = await registerUser(harness.app);
    const b = await registerUser(harness.app);
    const ws = await TestWs.connect(harness.wsUrl(b.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `user:${a.id}` });
    expect(String((await ws.next('error')).data.message)).toMatch(/denied/i);
    ws.close();
  });

  it('realtime failure does not corrupt notification persistence', async () => {
    // no socket connected → the realtime emit is a no-op; the row must still exist
    const admin = await registerAdmin(harness.app);
    const owner = await registerApprovedVet(harness.app);
    await createActiveOrganization(harness.app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'RT Clinic 2',
    });
    await new Promise((r) => setTimeout(r, 60));
    const rows = await (
      await import('../helpers/db.js')
    )
      .getTestDb()('notifications')
      .where({ recipient_user_id: owner.id })
      .count();
    expect(Number((rows[0] as { count: string }).count)).toBeGreaterThan(0);
  });
});
