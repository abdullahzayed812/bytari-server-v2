import type { Logger } from 'pino';
import type { EmailService } from '../../infra/email/index.js';
import type { DomainEvent, EventBus } from '../../shared/events/index.js';
import type { UserService } from '../users/user.service.js';
import type { VeterinarianRepository } from './veterinarian.repository.js';

/** Retry window: approvals older than this are never (re)mailed by the sweep. */
export const APPROVAL_EMAIL_RETRY_LOOKBACK_DAYS = 7;
const RETRY_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RETRY_DELAY_MS = 2 * 60 * 1000;
const RETRY_BATCH = 100;

export type ApprovalEmailOutcome = 'SENT' | 'DUPLICATE' | 'FAILED';

/** Escape the few characters that matter inside an HTML text node. */
function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * "تمت الموافقة على حسابك" — emails a veterinarian once an admin approves
 * their application, at the account's email (the one used to register).
 *
 * - Listens to `veterinarian.approved`, which `VeterinarianService.approve`
 *   publishes only AFTER the approval transaction commits — a rolled-back
 *   approval (or a pending / rejected vet) never gets anything.
 * - Exactly once per application: `approval_email_sent_at` is claimed
 *   atomically before sending, so a duplicate event, a retry, or a second
 *   node is a no-op. (A concurrent second approval cannot commit at all —
 *   `decide` is conditional on PENDING.)
 * - Never blocks or undoes the approval: delivery failures are logged, the
 *   claim is released, and the {@link retryPending} sweep (every 30 min,
 *   started by `server.ts`) re-sends approvals of the last 7 days that are
 *   still unsent — including ones lost to a crash between commit and send.
 * - The message carries no sensitive data: no ids, tokens, passwords, links
 *   with credentials or document details — just the greeting and the outcome.
 */
export class VeterinarianApprovalEmailHandler {
  private readonly log: Logger;
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly users: UserService,
    private readonly email: EmailService,
    private readonly applications: VeterinarianRepository,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'veterinarian-approval-email' });
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.eventBus.subscribe<{ userId: string; applicationId: string }>(
      'veterinarian.approved',
      (event) => this.handle(event).then(() => undefined),
    );
  }

  /** Periodic retry of failed / lost deliveries — process entry point only (not tests). */
  startRetrySweep(): void {
    if (this.timer) return;
    const run = (): void => {
      void this.retryPending().catch((err: unknown) =>
        this.log.error({ err }, 'veterinarian approval email retry sweep failed'),
      );
    };
    this.firstRun = setTimeout(run, FIRST_RETRY_DELAY_MS);
    this.firstRun.unref();
    this.timer = setInterval(run, RETRY_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
    this.firstRun = null;
    this.timer = null;
  }

  handle(
    event: DomainEvent<{ userId: string; applicationId: string }>,
  ): Promise<ApprovalEmailOutcome> {
    return this.deliver(event.payload.applicationId, event.payload.userId);
  }

  /** Re-send recent approvals whose email is still unsent. */
  async retryPending(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const since = new Date(now.getTime() - APPROVAL_EMAIL_RETRY_LOOKBACK_DAYS * 86_400_000);
    const due = await this.applications.listApprovedAwaitingEmail(since, RETRY_BATCH);
    let sent = 0;
    let failed = 0;
    for (const app of due) {
      const outcome = await this.deliver(app.id, app.userId);
      if (outcome === 'SENT') sent += 1;
      else if (outcome === 'FAILED') failed += 1;
    }
    if (due.length > 0) this.log.info({ sent, failed }, 'veterinarian approval email retry sweep');
    return { sent, failed };
  }

  private async deliver(applicationId: string, userId: string): Promise<ApprovalEmailOutcome> {
    let claimed = false;
    try {
      claimed = await this.applications.claimApprovalEmail(applicationId);
      if (!claimed) return 'DUPLICATE';
      const user = await this.users.getById(userId);
      const name = user.firstName?.trim() || '';
      const result = await this.email.send({
        to: user.email,
        subject: 'تمت الموافقة على حسابك في بيطري — Your Bytari account is approved',
        text:
          `مرحباً ${name}،\n\n` +
          'يسعدنا إبلاغك بأن الإدارة وافقت على حسابك كطبيب بيطري في تطبيق «بيطري». ' +
          'يمكنك الآن تسجيل الدخول والوصول إلى جميع خدمات الأطباء البيطريين.\n\n' +
          'إذا لم تقم بإنشاء هذا الحساب، يرجى التواصل مع فريق الدعم.\n\n' +
          '---\n\n' +
          `Hello ${name},\n\n` +
          'Your veterinarian account on Bytari has been approved by the administration. ' +
          'You can now sign in and use all veterinarian services.\n\n' +
          'If you did not create this account, please contact support.',
        html:
          `<div dir="rtl" style="font-family:Arial,sans-serif">` +
          `<p>مرحباً ${escapeHtml(name)}،</p>` +
          '<p>يسعدنا إبلاغك بأن الإدارة <strong>وافقت على حسابك كطبيب بيطري</strong> في تطبيق «بيطري». ' +
          'يمكنك الآن تسجيل الدخول والوصول إلى جميع خدمات الأطباء البيطريين.</p>' +
          '<p>إذا لم تقم بإنشاء هذا الحساب، يرجى التواصل مع فريق الدعم.</p></div>' +
          '<hr/>' +
          `<div dir="ltr" style="font-family:Arial,sans-serif">` +
          `<p>Hello ${escapeHtml(name)},</p>` +
          '<p>Your veterinarian account on Bytari has been <strong>approved</strong> by the administration. ' +
          'You can now sign in and use all veterinarian services.</p>' +
          '<p>If you did not create this account, please contact support.</p></div>',
      });
      if (!result.success) {
        await this.applications.releaseApprovalEmail(applicationId);
        this.log.warn(
          { userId, applicationId },
          'veterinarian approval email was not delivered — will retry',
        );
        return 'FAILED';
      }
      return 'SENT';
    } catch (err) {
      if (claimed) {
        await this.applications.releaseApprovalEmail(applicationId).catch(() => undefined);
      }
      this.log.error(
        { err, userId, applicationId },
        'veterinarian approval email failed — approval unaffected, will retry',
      );
      return 'FAILED';
    }
  }
}
