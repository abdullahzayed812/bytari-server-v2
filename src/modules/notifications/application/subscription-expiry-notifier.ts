import type { Logger } from 'pino';
import type { NotificationType } from '../domain/notification.constants.js';
import { NOTIFICATION_COPY } from '../domain/notification.copy.js';
import type { NotificationSpec } from '../domain/notification.types.js';
import type {
  NotificationRecipientRepository,
  SubscriptionWindowRow,
} from '../infrastructure/recipient.repository.js';
import type { NotificationService } from './notification.service.js';

/** Warn this many days before `subscription_end_date`. */
export const SUBSCRIPTION_EXPIRING_WINDOW_DAYS = 7;
/** Only report expiries this recent — never notify about long-dead subscriptions. */
export const SUBSCRIPTION_EXPIRED_LOOKBACK_DAYS = 7;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 60 * 1000;
const SWEEP_LIMIT = 1000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Periodic "subscription expiring / expired" notifications for FARM /
 * VETERINARY_OFFICE / CLINIC organizations — there is no domain event for the
 * passage of time, so this is the one notification source that is not
 * EventBus-driven.
 *
 * Exactly-once per subscription period: each spec's `sourceEventKey` is
 * `subscription.{expiring|expired}:<orgId>:<endDate>`, so the partial unique
 * index on `notifications` turns every re-run (every 6 h, a restart, a second
 * node) into a no-op. A renewal moves `end_date`, which arms the next warning.
 *
 * Started only by the process entry point (`server.ts`) — tests call
 * {@link runOnce} directly with a fixed clock.
 */
export class SubscriptionExpiryNotifier {
  private readonly log: Logger;
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;

  constructor(
    private readonly recipients: NotificationRecipientRepository,
    private readonly notifications: NotificationService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'subscription-expiry-notifier' });
  }

  start(): void {
    if (this.timer) return;
    const run = (): void => {
      void this.runOnce().catch((err: unknown) =>
        this.log.error({ err }, 'subscription expiry sweep failed'),
      );
    };
    this.firstRun = setTimeout(run, FIRST_SWEEP_DELAY_MS);
    this.firstRun.unref();
    this.timer = setInterval(run, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
    this.firstRun = null;
    this.timer = null;
  }

  async runOnce(now: Date = new Date()): Promise<{ expiring: number; expired: number }> {
    const today = isoDate(now);
    const [expiring, expired] = await Promise.all([
      this.recipients.subscriptionsEndingBetween(
        today,
        isoDate(addDays(now, SUBSCRIPTION_EXPIRING_WINDOW_DAYS)),
        SWEEP_LIMIT,
      ),
      this.recipients.subscriptionsEndingBetween(
        isoDate(addDays(now, -SUBSCRIPTION_EXPIRED_LOOKBACK_DAYS)),
        isoDate(addDays(now, -1)),
        SWEEP_LIMIT,
      ),
    ]);
    const specs = [
      ...expiring.map((r) => this.spec('SUBSCRIPTION_EXPIRING', 'subscription.expiring', r)),
      ...expired.map((r) => this.spec('SUBSCRIPTION_EXPIRED', 'subscription.expired', r)),
    ];
    if (specs.length > 0) await this.notifications.deliverSpecs(specs);
    this.log.info(
      { expiring: expiring.length, expired: expired.length },
      'subscription expiry sweep complete',
    );
    return { expiring: expiring.length, expired: expired.length };
  }

  private spec(
    type: NotificationType,
    keyPrefix: string,
    row: SubscriptionWindowRow,
  ): NotificationSpec {
    return {
      recipientUserId: row.ownerUserId,
      type,
      title: NOTIFICATION_COPY[type].title,
      body: NOTIFICATION_COPY[type].body,
      data: {
        type,
        organizationId: row.organizationId,
        organizationType: row.organizationType,
        endDate: row.endDate,
      },
      entityType: 'ORGANIZATION',
      entityId: row.organizationId,
      sourceEventKey: `${keyPrefix}:${row.organizationId}:${row.endDate}`,
      push: true,
    };
  }
}
