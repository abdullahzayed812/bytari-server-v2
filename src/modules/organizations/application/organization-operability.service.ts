import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import {
  SUBSCRIPTION_GATED_ORG_TYPES,
  computeOrganizationOperability,
  type OrganizationOperability,
} from '../domain/organization-operability.js';

export interface OperabilityOrgRef {
  id: string;
  type: string;
  status: string;
}

export interface SubscriptionDatesSource {
  getSubscriptionDates(
    organizationId: string,
  ): Promise<{ startDate: string | null; endDate: string | null }>;
}

/** Loads what `computeOrganizationOperability` needs; maps a denial to the standard 403 codes. */
export class OrganizationOperabilityService {
  constructor(
    private readonly subscriptions: SubscriptionDatesSource,
    private readonly authz: AuthorizationService,
  ) {}

  async assess(org: OperabilityOrgRef): Promise<OrganizationOperability> {
    const dates =
      org.status === 'ACTIVE' && SUBSCRIPTION_GATED_ORG_TYPES.has(org.type)
        ? await this.subscriptions.getSubscriptionDates(org.id)
        : null;
    return computeOrganizationOperability(org, dates);
  }

  /** Throws 403 `ORGANIZATION_NOT_ACTIVE` / `ORGANIZATION_SUBSCRIPTION_EXPIRED`. A global ADMIN bypasses. */
  async assertOperational(principal: AuthPrincipal | null, org: OperabilityOrgRef): Promise<void> {
    if (principal && this.authz.isAdmin(principal)) return;
    const decision = await this.assess(org);
    if (decision.operational) return;
    if (decision.reason === 'SUBSCRIPTION_EXPIRED') {
      throw new ForbiddenError(
        'This organization’s subscription has expired — renew it to continue',
        {
          code: ErrorCode.ORGANIZATION_SUBSCRIPTION_EXPIRED,
        },
      );
    }
    throw new ForbiddenError(
      decision.reason === 'PENDING_APPROVAL'
        ? 'Organization is pending approval — operations are restricted'
        : 'Organization is not active — operations are restricted',
      { code: ErrorCode.ORGANIZATION_NOT_ACTIVE },
    );
  }
}
