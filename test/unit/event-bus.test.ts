import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { ALL_EVENTS, InMemoryEventBus } from '../../src/shared/events/index.js';

const silentLogger = pino({ level: 'silent' });

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('InMemoryEventBus', () => {
  it('delivers a published event to a name subscriber (asynchronously)', async () => {
    const bus = new InMemoryEventBus(silentLogger);
    const handler = vi.fn();
    bus.subscribe('animal.created', handler);

    bus.publish('animal.created', { id: 'a1' }, { correlationId: 'req-1' });
    expect(handler).not.toHaveBeenCalled(); // async, next microtask

    await tick();
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]?.[0] as {
      name: string;
      payload: unknown;
      correlationId?: string;
    };
    expect(event.name).toBe('animal.created');
    expect(event.payload).toEqual({ id: 'a1' });
    expect(event.correlationId).toBe('req-1');
  });

  it('delivers to wildcard subscribers as well', async () => {
    const bus = new InMemoryEventBus(silentLogger);
    const named = vi.fn();
    const wild = vi.fn();
    bus.subscribe('x.happened', named);
    bus.subscribe(ALL_EVENTS, wild);

    bus.publish('x.happened', {});
    bus.publish('y.happened', {});
    await tick();

    expect(named).toHaveBeenCalledOnce();
    expect(wild).toHaveBeenCalledTimes(2);
  });

  it('isolates handler failures — one throwing handler does not stop others', async () => {
    const bus = new InMemoryEventBus(silentLogger);
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.subscribe('e', bad);
    bus.subscribe('e', good);

    expect(() => bus.publish('e', {})).not.toThrow();
    await tick();
    expect(good).toHaveBeenCalledOnce();
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = new InMemoryEventBus(silentLogger);
    const handler = vi.fn();
    const off = bus.subscribe('e', handler);

    off();
    bus.publish('e', {});
    await tick();
    expect(handler).not.toHaveBeenCalled();
  });
});
