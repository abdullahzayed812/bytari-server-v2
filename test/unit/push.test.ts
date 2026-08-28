import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import {
  InMemoryDeviceTokenRepository,
  NoopPushProvider,
  PushEventBridge,
  PushNotificationService,
  createPushProvider,
  type PushMessage,
  type PushNotificationProvider,
  type PushSendResult,
} from '../../src/infra/push/index.js';
import { InMemoryEventBus } from '../../src/shared/events/index.js';
import type { AppConfig } from '../../src/config/index.js';

const silentLogger = pino({ level: 'silent' });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function fakeProvider(result: Partial<PushSendResult> = {}): PushNotificationProvider {
  return {
    name: 'fake',
    isEnabled: () => true,
    send: vi.fn((m: PushMessage): Promise<PushSendResult> =>
      Promise.resolve({
        successCount: m.tokens.length,
        failureCount: 0,
        invalidTokens: [],
        provider: 'fake',
        ...result,
      }),
    ),
    shutdown: vi.fn(() => Promise.resolve()),
  };
}

describe('createPushProvider', () => {
  it('returns the noop provider when Firebase is not configured', () => {
    const provider = createPushProvider({ firebase: null } as AppConfig, silentLogger);
    expect(provider.name).toBe('noop');
    expect(provider.isEnabled()).toBe(false);
  });

  it('returns the firebase provider when configured (not yet initialised)', () => {
    const provider = createPushProvider(
      {
        firebase: {
          projectId: 'p',
          clientEmail: 'e@x',
          privateKey: 'k',
          serviceAccountJson: undefined,
        },
      } as AppConfig,
      silentLogger,
    );
    expect(provider.name).toBe('firebase');
    expect(provider.isEnabled()).toBe(true);
  });
});

describe('NoopPushProvider', () => {
  it('reports every token as delivered without doing anything', async () => {
    const res = await new NoopPushProvider(silentLogger).send({
      tokens: ['a', 'b'],
      notification: { title: 't', body: 'b' },
    });
    expect(res).toEqual({ successCount: 2, failureCount: 0, invalidTokens: [], provider: 'noop' });
  });
});

describe('PushNotificationService', () => {
  it('sends to all active device tokens of a user', async () => {
    const repo = new InMemoryDeviceTokenRepository();
    await repo.register({ userId: 'u1', token: 't1', platform: 'ios' });
    await repo.register({ userId: 'u1', token: 't2', platform: 'android' });
    await repo.register({ userId: 'u2', token: 't3', platform: 'web' });

    const provider = fakeProvider();
    const service = new PushNotificationService(provider, repo, silentLogger);
    const res = await service.sendToUser('u1', { title: 'Hi', body: 'there' });

    expect(res.successCount).toBe(2);
    const sent = (provider.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as PushMessage;
    expect(sent.tokens.sort()).toEqual(['t1', 't2']);
  });

  it('disables tokens the provider reports as invalid', async () => {
    const repo = new InMemoryDeviceTokenRepository();
    await repo.register({ userId: 'u1', token: 'good', platform: 'ios' });
    await repo.register({ userId: 'u1', token: 'stale', platform: 'ios' });

    const provider = fakeProvider({ invalidTokens: ['stale'], failureCount: 1, successCount: 1 });
    const service = new PushNotificationService(provider, repo, silentLogger);
    await service.sendToUser('u1', { title: 'x', body: 'y' });

    const active = await repo.listActiveForUser('u1');
    expect(active.map((d) => d.token)).toEqual(['good']);
  });

  it('is a no-op when the user has no devices', async () => {
    const provider = fakeProvider();
    const service = new PushNotificationService(
      provider,
      new InMemoryDeviceTokenRepository(),
      silentLogger,
    );
    const res = await service.sendToUser('ghost', { title: 'x', body: 'y' });
    expect(res.successCount).toBe(0);
    expect(provider.send).not.toHaveBeenCalled();
  });
});

describe('PushEventBridge', () => {
  it('forwards mapped domain events to the push service', async () => {
    const repo = new InMemoryDeviceTokenRepository();
    await repo.register({ userId: 'u1', token: 't1', platform: 'ios' });
    const provider = fakeProvider();
    const service = new PushNotificationService(provider, repo, silentLogger);
    const bus = new InMemoryEventBus(silentLogger);

    const bridge = new PushEventBridge(bus, service, silentLogger);
    bridge.route<{ userId: string; text: string }>('chat.message.created', (e) => ({
      toUserId: e.payload.userId,
      notification: { title: 'New message', body: e.payload.text },
    }));
    bridge.start();

    bus.publish('chat.message.created', { userId: 'u1', text: 'hello' });
    bus.publish('unmapped.event', { userId: 'u1' });
    await tick();
    await tick();

    expect(provider.send).toHaveBeenCalledOnce();
    bridge.stop();
  });
});
