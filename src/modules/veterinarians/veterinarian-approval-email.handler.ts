import type { Logger } from 'pino';
import type { EmailService } from '../../infra/email/index.js';
import type { DomainEvent, EventBus } from '../../shared/events/index.js';
import type { UserService } from '../users/user.service.js';

/** Escape the few characters that matter inside an HTML text node. */
function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * "تمت الموافقة على حسابك" — emails a veterinarian once an admin approves
 * their account.
 *
 * - Listens to `veterinarian.approved`, which `VeterinarianService.approve`
 *   publishes only AFTER the approval transaction commits — a rolled-back
 *   approval never sends anything.
 * - Delivery failures (SMTP down, unknown user …) are logged and swallowed:
 *   the approval itself is already committed and is never undone by email.
 * - The message carries no sensitive data: no ids, tokens, links with
 *   credentials or document details — just the greeting and the outcome.
 */
export class VeterinarianApprovalEmailHandler {
  private readonly log: Logger;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly users: UserService,
    private readonly email: EmailService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'veterinarian-approval-email' });
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.eventBus.subscribe<{ userId: string }>(
      'veterinarian.approved',
      (event) => this.handle(event),
    );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async handle(event: DomainEvent<{ userId: string }>): Promise<void> {
    try {
      const user = await this.users.getById(event.payload.userId);
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
        this.log.warn({ userId: user.id }, 'veterinarian approval email was not delivered');
      }
    } catch (err) {
      this.log.error(
        { err, userId: event.payload.userId },
        'veterinarian approval email failed — approval unaffected',
      );
    }
  }
}
