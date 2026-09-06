import { BadRequestError, ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { FarmSubscriptionStatus } from './farm-subscription.types.js';
import type { FarmSubscriptionRenewalRequest } from './farm-subscription.types.js';

/** Pure business rules for the farm subscription + renewal-request workflow. No I/O. */
export const FarmSubscriptionPolicy = {
  assertValidPeriod(startDate: string, endDate: string): void {
    if (endDate < startDate) {
      throw new BadRequestError('Subscription end date must not be before the start date', {
        code: ErrorCode.INVALID_SUBSCRIPTION_DATES,
      });
    }
  },

  /**
   * Only the farm's owner (or a global admin, who bypasses org-scoped
   * middleware entirely and never reaches this check) may request a renewal.
   */
  assertOwner(organization: { ownerUserId: string }, actorUserId: string): void {
    if (organization.ownerUserId !== actorUserId) {
      throw new ForbiddenError('Only the farm owner can request a subscription renewal', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  /** A renewal can only be requested once the current subscription has expired. */
  assertExpired(subscriptionStatus: FarmSubscriptionStatus): void {
    if (subscriptionStatus !== 'EXPIRED') {
      throw new ConflictError(
        'A subscription renewal can only be requested once the current subscription has expired',
        { code: ErrorCode.SUBSCRIPTION_NOT_EXPIRED },
      );
    }
  },

  assertPending(request: Pick<FarmSubscriptionRenewalRequest, 'status'>): void {
    if (request.status !== 'PENDING') {
      throw new ConflictError('This renewal request has already been resolved', {
        code: ErrorCode.RENEWAL_REQUEST_NOT_PENDING,
      });
    }
  },
} as const;
