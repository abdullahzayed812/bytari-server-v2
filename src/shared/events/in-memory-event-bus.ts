import type { Logger } from 'pino';
import { ALL_EVENTS, type DomainEvent, type EventBus, type EventHandler } from './event-bus.js';

/**
 * Single-process {@link EventBus} backed by plain `Map`s of handler sets.
 * Handlers run on the microtask queue; failures are isolated and logged.
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger.child({ component: 'event-bus' });
  }

  publish<T>(name: string, payload: T, meta?: { correlationId?: string }): void {
    const event: DomainEvent<T> = {
      name,
      payload,
      occurredAt: new Date(),
      correlationId: meta?.correlationId,
    };

    const targets = [...(this.handlers.get(name) ?? []), ...(this.handlers.get(ALL_EVENTS) ?? [])];
    if (targets.length === 0) {
      this.log.debug({ event: name }, 'domain event published with no subscribers');
      return;
    }

    for (const handler of targets) {
      queueMicrotask(() => {
        void this.invoke(handler, event);
      });
    }
  }

  subscribe<T = unknown>(name: string, handler: EventHandler<T>): () => void {
    const set = this.handlers.get(name) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.handlers.set(name, set);

    return () => {
      const current = this.handlers.get(name);
      if (!current) return;
      current.delete(handler as EventHandler);
      if (current.size === 0) this.handlers.delete(name);
    };
  }

  private async invoke(handler: EventHandler, event: DomainEvent): Promise<void> {
    try {
      await handler(event);
    } catch (err) {
      this.log.error({ err, event: event.name }, 'event handler failed');
    }
  }
}
