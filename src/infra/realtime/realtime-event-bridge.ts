import type { Logger } from 'pino';
import { ALL_EVENTS, type DomainEvent, type EventBus } from '../../shared/events/index.js';
import type { RealtimeEvent, RealtimePublisher } from './types.js';

/** Where a forwarded event should go, plus the client-facing payload. */
export interface RealtimeForward {
  toUserId?: string;
  toRoom?: string;
  broadcast?: boolean;
  event: RealtimeEvent;
}

/** Maps a domain event onto zero, one or many real-time deliveries. */
export type RealtimeRouteMapper<T = unknown> = (
  event: DomainEvent<T>,
) => RealtimeForward | RealtimeForward[] | null;

/**
 * Bridges the domain {@link EventBus} to the {@link RealtimePublisher}.
 *
 * Modules keep publishing plain domain events; they register a mapper here (in
 * their composition root) to have specific events pushed over WebSocket. No
 * module imports the gateway directly.
 *
 * Phase 1 ships the bridge with no routes registered.
 */
export class RealtimeEventBridge {
  private readonly log: Logger;
  private readonly routes = new Map<string, RealtimeRouteMapper>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly publisher: RealtimePublisher,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'realtime-bridge' });
  }

  /** Register (or replace) the mapper for a domain event name. Chainable. */
  route<T = unknown>(eventName: string, mapper: RealtimeRouteMapper<T>): this {
    this.routes.set(eventName, mapper as RealtimeRouteMapper);
    return this;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.eventBus.subscribe(ALL_EVENTS, (event) => this.dispatch(event));
    this.log.debug('realtime event bridge started');
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private dispatch(event: DomainEvent): void {
    const mapper = this.routes.get(event.name);
    if (!mapper) return;

    let result: RealtimeForward | RealtimeForward[] | null;
    try {
      result = mapper(event);
    } catch (err) {
      this.log.error({ err, event: event.name }, 'realtime route mapper threw');
      return;
    }
    if (!result) return;

    for (const forward of Array.isArray(result) ? result : [result]) {
      if (forward.broadcast) this.publisher.broadcast(forward.event);
      if (forward.toRoom) this.publisher.emitToRoom(forward.toRoom, forward.event);
      if (forward.toUserId) this.publisher.emitToUser(forward.toUserId, forward.event);
    }
  }
}
