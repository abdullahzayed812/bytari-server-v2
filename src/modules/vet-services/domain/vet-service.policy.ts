import { ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type {
  VetServiceEngagementStatus,
  VetServiceModerationStatus,
} from './vet-service.constants.js';

/**
 * Pure business rules for the veterinary-services marketplace. No I/O.
 * Ownership resolution and vet-approval checks live in the services /
 * `AuthorizationService`; these are the invariants.
 */
export const VetServicePolicy = {
  /** Moderation transitions apply only to a PENDING listing / request. */
  assertModerationPending(entity: { status: VetServiceModerationStatus }): void {
    if (entity.status !== 'PENDING') {
      throw new ConflictError('This submission has already been reviewed', {
        code: ErrorCode.VET_SERVICE_NOT_PENDING,
      });
    }
  },

  /** Only the creator may edit / delete / close their own listing or request. */
  assertOwner(entity: { ownerUserId: string }, actorUserId: string, label: string): void {
    if (entity.ownerUserId !== actorUserId) {
      throw new ForbiddenError(`Only the ${label} owner can perform this action`, {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  /** A vet cannot submit an offer on their own request; an owner cannot request their own listing. */
  assertNotSelf(counterpartUserId: string, actorUserId: string, message: string): void {
    if (counterpartUserId === actorUserId) {
      throw new ForbiddenError(message, { code: ErrorCode.PERMISSION_DENIED });
    }
  },

  /** Engagement (offer / listing-request) responses apply only while PENDING. */
  assertEngagementPending(engagement: { status: VetServiceEngagementStatus }): void {
    if (engagement.status !== 'PENDING') {
      throw new ConflictError('This offer / request has already been decided', {
        code: ErrorCode.VET_SERVICE_ENGAGEMENT_NOT_PENDING,
      });
    }
  },

  /** "إنهاء الطلب" — completion applies only to an ACCEPTED engagement. */
  assertEngagementAccepted(engagement: { status: VetServiceEngagementStatus }): void {
    if (engagement.status !== 'ACCEPTED') {
      throw new ConflictError('Only an accepted engagement can be completed', {
        code: ErrorCode.VET_SERVICE_ENGAGEMENT_NOT_PENDING,
      });
    }
  },

  /** You can only submit an offer / request against an APPROVED, open listing or request. */
  assertPubliclyEngageable(
    entity: { status: string; closedAt: string | null },
    label: string,
  ): void {
    if (entity.status !== 'APPROVED' || entity.closedAt !== null) {
      throw new ConflictError(`This ${label} is not open for offers`, {
        code: ErrorCode.VET_SERVICE_NOT_OPEN,
      });
    }
  },
} as const;
