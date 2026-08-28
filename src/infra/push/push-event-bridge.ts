import type { Logger } from 'pino';
import { ALL_EVENTS, type DomainEvent, type EventBus } from '../../shared/events/index.js';
import type { PushNotificationService } from './push-notification-service.js';
import type { PushNotificationPayload, PushMessage } from './types.js';

export interface PushForward {
  toUserId: string;
  notification: PushNotificationPayload;
  data?: Record<string, string>;
  options?: PushMessage['options'];
}

export type PushRouteMapper<T = unknown> = (
  event: DomainEvent<T>,
) => PushForward | PushForward[] | null;

/**
 * Bridges the domain {@link EventBus} to {@link PushNotificationService}.
 * Modules register a mapper for the events that should trigger a push. Phase 1
 * ships it with no routes.
 */
export class PushEventBridge {
  private readonly log: Logger;
  private readonly routes = new Map<string, PushRouteMapper>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly push: PushNotificationService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'push-bridge' });
  }

  route<T = unknown>(eventName: string, mapper: PushRouteMapper<T>): this {
    this.routes.set(eventName, mapper as PushRouteMapper);
    return this;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.eventBus.subscribe(ALL_EVENTS, (event) => {
      void this.dispatch(event);
    });
    this.log.debug('push event bridge started');
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    const mapper = this.routes.get(event.name);
    if (!mapper) return;

    let result: PushForward | PushForward[] | null;
    try {
      result = mapper(event);
    } catch (err) {
      this.log.error({ err, event: event.name }, 'push route mapper threw');
      return;
    }
    if (!result) return;

    for (const forward of Array.isArray(result) ? result : [result]) {
      try {
        await this.push.sendToUser(
          forward.toUserId,
          forward.notification,
          forward.data,
          forward.options,
        );
      } catch (err) {
        this.log.error({ err, event: event.name }, 'push dispatch failed');
      }
    }
  }
}
