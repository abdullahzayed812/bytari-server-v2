import type { Logger } from 'pino';
import { ALL_EVENTS, type DomainEvent, type EventBus } from '../../../shared/events/index.js';
import type { NotificationPolicy } from '../domain/notification.policy.js';
import type { NotificationService } from './notification.service.js';

/**
 * Subscribes to the existing {@link EventBus} and turns domain events into
 * notifications via {@link NotificationPolicy} → {@link NotificationService}.
 *
 * - Events arrive AFTER the originating transaction commits — no notification
 *   work runs inside another module's transaction.
 * - Its own `notification.*` events are ignored, so it can never trigger
 *   itself (loop guard).
 * - Handler errors are logged and swallowed; they never propagate to the
 *   publisher.
 */
export class NotificationEventHandler {
  private readonly log: Logger;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly policy: NotificationPolicy,
    private readonly service: NotificationService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'notification-handler' });
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.eventBus.subscribe(ALL_EVENTS, (event) => {
      void this.handle(event);
    });
    this.log.debug('notification event handler started');
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async handle(event: DomainEvent): Promise<void> {
    if (event.name.startsWith('notification.')) return; // loop guard
    try {
      const specs = await this.policy.resolve(event);
      if (specs.length === 0) return;
      await this.service.deliverSpecs(specs);
    } catch (err) {
      this.log.error({ err, event: event.name }, 'notification handler failed');
    }
  }
}
