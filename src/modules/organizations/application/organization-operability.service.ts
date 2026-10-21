import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import {
  STAFF_OPERATE_WHEN_EXPIRED_ORG_TYPES,
  SUBSCRIPTION_GATED_ORG_TYPES,
  computeOrganizationOperability,
  type OrganizationOperability,
} from '../domain/organization-operability.js';

export interface OperabilityOrgRef {
  id: string;
  type: string;
  status: string;
  /** `organizations.owner_user_id` — when known, an extra owner signal besides the OWNER membership. */
  ownerUserId?: string | null;
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

  /**
   * `assess`, from one user's point of view: in a `STAFF_OPERATE_WHEN_EXPIRED`
   * type an expired subscription only stops the OWNER — an ACTIVE non-owner
   * member (from the membership records, never the request) still operates.
   * Anyone else (owner, non-member) gets the organization-level answer.
   */
  async assessForUser(userId: string, org: OperabilityOrgRef): Promise<OrganizationOperability> {
    const decision = await this.assess(org);
    if (
      decision.operational ||
      decision.reason !== 'SUBSCRIPTION_EXPIRED' ||
      !STAFF_OPERATE_WHEN_EXPIRED_ORG_TYPES.has(org.type)
    ) {
      return decision;
    }
    return (await this.isNonOwnerStaff(userId, org)) ? { operational: true } : decision;
  }

  private async isNonOwnerStaff(userId: string, org: OperabilityOrgRef): Promise<boolean> {
    if (org.ownerUserId != null && org.ownerUserId === userId) return false;
    const membership = await this.authz.getOrganizationMembershipContext(userId, org.id);
    return membership !== null && !membership.isOwner;
  }

  /**
   * Throws 403 `ORGANIZATION_NOT_ACTIVE` / `ORGANIZATION_SUBSCRIPTION_EXPIRED`.
   * A global ADMIN bypasses. With a principal the decision is per user
   * (`assessForUser`); `null` (a counterpart-neutral check such as a pet-owner
   * chat) uses the organization-level rule.
   */
  async assertOperational(principal: AuthPrincipal | null, org: OperabilityOrgRef): Promise<void> {
    if (principal && this.authz.isAdmin(principal)) return;
    const decision = principal
      ? await this.assessForUser(principal.userId, org)
      : await this.assess(org);
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
