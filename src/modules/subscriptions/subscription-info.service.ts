import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import type { AuthorizationService } from '../authorization/authorization.service.js';
import type { AuthPrincipal } from '../authorization/authorization.types.js';
import type { AuditContext } from '../audit/audit.types.js';
import type { SupportThreadService } from '../consultations/application/support-thread.service.js';
import type { OrganizationRepository } from '../organizations/infrastructure/organization.repository.js';
import type { TraderService } from '../poultryMarket/application/trader.service.js';

/** Every subscription-bearing subject that shows the free-trial info + "send subscription info". */
export const SUBSCRIPTION_SUBJECTS = [
  'CLINIC',
  'VETERINARY_OFFICE',
  'POULTRY_FARM',
  'SHEEP_FARM',
  'CATTLE_FARM',
  'POULTRY_TRADER',
] as const;
export type SubscriptionSubject = (typeof SUBSCRIPTION_SUBJECTS)[number];

/** The organization type each organization-backed subject must reference. */
const SUBJECT_ORG_TYPE: Record<Exclude<SubscriptionSubject, 'POULTRY_TRADER'>, string> = {
  CLINIC: 'CLINIC',
  VETERINARY_OFFICE: 'VETERINARY_OFFICE',
  POULTRY_FARM: 'FARM',
  SHEEP_FARM: 'FARM',
  CATTLE_FARM: 'FARM',
};

const SUBJECT_LABEL_AR: Record<SubscriptionSubject, string> = {
  CLINIC: 'عيادة بيطرية',
  VETERINARY_OFFICE: 'مكتب بيطري',
  POULTRY_FARM: 'حقل دواجن',
  SHEEP_FARM: 'حقل أغنام',
  CATTLE_FARM: 'حقل أبقار',
  POULTRY_TRADER: 'تاجر في سوق الدواجن',
};

const STATUS_LABEL_AR: Record<string, string> = {
  NOT_STARTED: 'لم يبدأ بعد',
  ACTIVE: 'نشط',
  EXPIRED: 'منتهٍ',
};

export interface SubscriptionInfoDTO {
  subject: SubscriptionSubject;
  /** Free-trial length in days (server config `SUBSCRIPTION_FREE_TRIAL_DAYS`). */
  freeTrialDays: number;
}

export interface SubscriptionInfoActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

/**
 * Subscription free-trial information + "إرسال معلومات الاشتراك".
 *
 * The request is delivered through the EXISTING support channel ("تواصل معنا"
 * → ADMIN / SUPPORT supervisor): a SUPPORT thread owned by the caller whose
 * first message carries the subject, its name and its current subscription
 * state, so the administration can answer in the same thread. No new
 * messaging system, no new tables.
 *
 * Authorization: an organization subject needs `organization.update` in that
 * organization (OWNER override / an explicitly-granted supervisor / ADMIN) —
 * a plain member cannot open subscription conversations on the owner's
 * behalf; a trader subject needs the caller's OWN trader registration.
 */
export class SubscriptionInfoService {
  constructor(
    private readonly freeTrialDays: number,
    private readonly organizations: OrganizationRepository,
    private readonly traders: TraderService,
    private readonly authz: AuthorizationService,
    private readonly support: SupportThreadService,
  ) {}

  info(subject: SubscriptionSubject): SubscriptionInfoDTO {
    return { subject, freeTrialDays: this.freeTrialDays };
  }

  async sendInfoRequest(
    actor: SubscriptionInfoActor,
    input: { subject: SubscriptionSubject; organizationId?: string; note?: string },
  ): Promise<{ threadId: string }> {
    const lines: string[] = ['طلب معلومات الاشتراك', `النوع: ${SUBJECT_LABEL_AR[input.subject]}`];

    if (input.subject === 'POULTRY_TRADER') {
      const { profile } = await this.traders.getStatus(actor.principal.userId);
      if (!profile) {
        throw new ForbiddenError('You are not registered as a poultry-market trader', {
          code: ErrorCode.PERMISSION_DENIED,
        });
      }
      lines.push(`الاسم: ${profile.displayName}`);
      lines.push(...this.stateLines(profile.subscriptionStatus, profile.subscriptionEndDate));
    } else {
      if (!input.organizationId) {
        throw new BadRequestError('organizationId is required for this subject', {
          details: [{ path: 'body.organizationId', message: 'required' }],
        });
      }
      const org = await this.organizations.findByIdWithDetails(input.organizationId);
      // A foreign / missing organization is hidden as 404 (no existence leak).
      if (
        !org ||
        org.type !== SUBJECT_ORG_TYPE[input.subject] ||
        org.status === 'DEACTIVATED' ||
        !(await this.authz.canInOrganization(actor.principal, 'organization.update', org.id))
      ) {
        throw new NotFoundError('Organization not found');
      }
      lines.push(`الاسم: ${org.name}`);
      lines.push(
        ...this.stateLines(
          org.details.subscriptionStatus ?? 'NOT_STARTED',
          org.details.subscriptionEndDate ?? null,
        ),
      );
    }

    lines.push(`الفترة المجانية: ${this.freeTrialDays} يوماً`);
    const note = input.note?.trim();
    if (note) lines.push(`ملاحظة: ${note}`);
    lines.push('أرجو تزويدي بمعلومات الاشتراك وطريقة التفعيل أو التجديد.');

    const thread = await this.support.create(actor, { body: lines.join('\n') });
    return { threadId: thread.id };
  }

  private stateLines(status: string, endDate: string | null): string[] {
    const out = [`حالة الاشتراك الحالية: ${STATUS_LABEL_AR[status] ?? status}`];
    if (endDate) out.push(`تاريخ انتهاء الاشتراك: ${endDate}`);
    return out;
  }
}
