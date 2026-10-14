import type { Logger } from 'pino';
import { businessToday } from '../../../shared/time/business-date.js';
import type { NotificationPolicy } from '../domain/notification.policy.js';
import type { NotificationRecipientRepository } from '../infrastructure/recipient.repository.js';
import type { NotificationService } from './notification.service.js';

/** Remind the owner this many days before `next_due_on` (the due day itself included). */
export const VACCINATION_DUE_REMINDER_DAYS = 3;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 90 * 1000;
const SWEEP_LIMIT = 500;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Automatic "vaccination due" reminder to the pet's CURRENT owner — the time
 * passing is not a domain event, so (like `SubscriptionExpiryNotifier`) this
 * sweeps on an interval instead of listening on the EventBus.
 *
 * - Window: SCHEDULED vaccinations with `next_due_on` between today and
 *   today + {@link VACCINATION_DUE_REMINDER_DAYS} in the BUSINESS time zone
 *   (Iraq), never UTC — a late-evening sweep must not skip a day.
 * - Exactly once per vaccination per due date: the spec's `sourceEventKey`
 *   is `vaccination.due:<id>:<nextDueOn>` and the partial unique index on
 *   `notifications` makes every re-run / restart / second node a no-op. The
 *   query also skips already-reminded rows, so the batch cap never starves.
 *   Editing the due date re-arms the reminder; COMPLETED / CANCELLED stop it.
 * - Recipient + copy come from {@link NotificationPolicy} (`vaccination.due`),
 *   the same mapping as the clinic's manual "إرسال إشعار" (`VACCINATION_DUE`).
 * - Delivery is {@link NotificationService.deliverSpecs}: in-app row, then
 *   realtime + FCM best-effort; one recipient's failure never stops the rest.
 *   Reads only committed rows — it runs outside every write transaction.
 *
 * Started only by `server.ts`; tests call {@link runOnce} with a fixed clock.
 */
export class VaccinationDueNotifier {
  private readonly log: Logger;
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly recipients: NotificationRecipientRepository,
    private readonly policy: NotificationPolicy,
    private readonly notifications: NotificationService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vaccination-due-notifier' });
  }

  start(): void {
    if (this.timer) return;
    const run = (): void => {
      void this.runOnce().catch((err: unknown) =>
        this.log.error({ err }, 'vaccination due sweep failed'),
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

  async runOnce(now: Date = new Date()): Promise<{ due: number; specs: number }> {
    // Overlapping sweeps would only produce duplicate-key no-ops; skip anyway.
    if (this.running) return { due: 0, specs: 0 };
    this.running = true;
    try {
      const today = businessToday(now);
      const rows = await this.recipients.vaccinationsDueBetween(
        today,
        addDays(today, VACCINATION_DUE_REMINDER_DAYS),
        SWEEP_LIMIT,
      );
      let specs = 0;
      for (const row of rows) {
        try {
          const resolved = await this.policy.resolve({
            name: 'vaccination.due',
            occurredAt: now,
            payload: {
              vaccinationId: row.vaccinationId,
              animalId: row.animalId,
              organizationId: row.organizationId,
              petOwnerUserId: row.ownerUserId,
              nextDueOn: row.nextDueOn,
            },
          });
          specs += resolved.length;
          if (resolved.length > 0) await this.notifications.deliverSpecs(resolved);
        } catch (err) {
          this.log.error(
            { err, vaccinationId: row.vaccinationId },
            'vaccination due reminder failed',
          );
        }
      }
      this.log.info({ due: rows.length, specs }, 'vaccination due sweep complete');
      return { due: rows.length, specs };
    } finally {
      this.running = false;
    }
  }
}
