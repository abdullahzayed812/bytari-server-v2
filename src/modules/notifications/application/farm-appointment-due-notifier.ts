import type { Logger } from 'pino';
import { businessHour, businessToday } from '../../../shared/time/business-date.js';
import type { FarmAppointmentRepository } from '../../farms/infrastructure/farm-appointment.repository.js';
import type { NotificationPolicy } from '../domain/notification.policy.js';
import type { NotificationService } from './notification.service.js';

/** Reminders go out from this local (business time zone) hour on the scheduled day. */
export const FARM_APPOINTMENT_REMINDER_HOUR = 8;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
const PAGE_SIZE = 200;

/**
 * "موعد اليوم" — on an appointment's scheduled day, remind the farm owner, the
 * assigned veterinarian and every member who can read appointments
 * (`NotificationPolicy` → `farm.appointment.due`).
 *
 * - Date: `scheduled_for` equals TODAY in the business time zone (Iraq), never
 *   UTC; nothing is sent before {@link FARM_APPOINTMENT_REMINDER_HOUR}:00 local,
 *   so a midnight sweep does not wake anybody up.
 * - Only UPCOMING appointments of ACTIVE farms (DONE / CANCELLED / deleted
 *   farms never remind).
 * - Exactly once per recipient per scheduled date: `sourceEventKey` is
 *   `farm.appointment.due:<id>:<date>` and the partial unique index on
 *   `notifications` turns every re-run (each sweep re-walks today's list, so a
 *   recipient whose delivery failed is retried) into a no-op without a push.
 *   Rescheduling to another day re-arms it.
 * - One appointment's failure never stops the sweep.
 *
 * Started only by `server.ts`; tests call {@link runOnce} with a fixed clock.
 */
export class FarmAppointmentDueNotifier {
  private readonly log: Logger;
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly appointments: FarmAppointmentRepository,
    private readonly policy: NotificationPolicy,
    private readonly notifications: NotificationService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'farm-appointment-due-notifier' });
  }

  start(): void {
    if (this.timer) return;
    const run = (): void => {
      void this.runOnce().catch((err: unknown) =>
        this.log.error({ err }, 'farm appointment due sweep failed'),
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
    if (this.running) return { due: 0, specs: 0 };
    if (businessHour(now) < FARM_APPOINTMENT_REMINDER_HOUR) return { due: 0, specs: 0 };
    this.running = true;
    try {
      const today = businessToday(now);
      let due = 0;
      let specs = 0;
      let afterId: string | null = null;
      for (;;) {
        const page = await this.appointments.listUpcomingOn(today, afterId, PAGE_SIZE);
        if (page.length === 0) break;
        for (const a of page) {
          due += 1;
          try {
            const resolved = await this.policy.resolve({
              name: 'farm.appointment.due',
              occurredAt: now,
              payload: {
                organizationId: a.organizationId,
                appointmentId: a.id,
                scheduledFor: a.scheduledFor,
                title: a.title,
                assignedVeterinarianUserId: a.assignedVeterinarianUserId,
              },
            });
            specs += resolved.length;
            if (resolved.length > 0) await this.notifications.deliverSpecs(resolved);
          } catch (err) {
            this.log.error({ err, appointmentId: a.id }, 'farm appointment reminder failed');
          }
        }
        afterId = page[page.length - 1]?.id ?? null;
        if (page.length < PAGE_SIZE) break;
      }
      this.log.info({ due, specs }, 'farm appointment due sweep complete');
      return { due, specs };
    } finally {
      this.running = false;
    }
  }
}
