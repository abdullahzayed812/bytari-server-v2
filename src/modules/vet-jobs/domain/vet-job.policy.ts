import { ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { VetJobApplicationStatus, VetJobModerationStatus } from './vet-job.constants.js';

/**
 * Pure business rules for Veterinarian Jobs. No I/O. Ownership resolution and
 * veterinarian-approval checks live in the services / `AuthorizationService`;
 * these are the invariants.
 */
export const VetJobPolicy = {
  /** Moderation transitions apply only to a PENDING offer / seeker profile. */
  assertModerationPending(entity: { status: VetJobModerationStatus }): void {
    if (entity.status !== 'PENDING') {
      throw new ConflictError('This submission has already been reviewed', {
        code: ErrorCode.VET_JOB_NOT_PENDING,
      });
    }
  },

  /** Only the creator may edit / delete / close their own offer or profile. */
  assertOwner(entity: { ownerUserId: string }, actorUserId: string, label: string): void {
    if (entity.ownerUserId !== actorUserId) {
      throw new ForbiddenError(`Only the ${label} owner can perform this action`, {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  /** A veterinarian cannot apply to their own job offer. */
  assertNotSelf(posterUserId: string, actorUserId: string): void {
    if (posterUserId === actorUserId) {
      throw new ForbiddenError('You cannot apply to your own job offer', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  /** You can only apply to / contact an APPROVED, open (not closed, not past deadline) offer. */
  assertOfferOpen(offer: {
    status: string;
    closedAt: string | null;
    applicationDeadline: string | null;
  }): void {
    if (offer.status !== 'APPROVED' || offer.closedAt !== null) {
      throw new ConflictError('This job offer is not open for applications', {
        code: ErrorCode.VET_JOB_NOT_OPEN,
      });
    }
    if (offer.applicationDeadline && offer.applicationDeadline < new Date().toISOString().slice(0, 10)) {
      throw new ConflictError('The application deadline for this job offer has passed', {
        code: ErrorCode.VET_JOB_NOT_OPEN,
      });
    }
  },

  /** Accept / reject applies only to a PENDING application. */
  assertApplicationPending(application: { status: VetJobApplicationStatus }): void {
    if (application.status !== 'PENDING') {
      throw new ConflictError('This application has already been decided', {
        code: ErrorCode.VET_JOB_APPLICATION_NOT_PENDING,
      });
    }
  },
} as const;
