import { ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { VetCourseModerationStatus } from './vet-course.constants.js';

/**
 * Pure business rules for Veterinarian Courses & Seminars. No I/O. Ownership
 * resolution and veterinarian-approval checks live in the services /
 * `AuthorizationService`; these are the invariants.
 */
export const VetCoursePolicy = {
  /** Moderation transitions apply only to a PENDING course / seminar / workshop. */
  assertModerationPending(entity: { status: VetCourseModerationStatus }): void {
    if (entity.status !== 'PENDING') {
      throw new ConflictError('This submission has already been reviewed', {
        code: ErrorCode.VET_COURSE_NOT_PENDING,
      });
    }
  },

  /** Only the creator may edit / cancel / delete their own submission. */
  assertOwner(entity: { creatorUserId: string }, actorUserId: string, label: string): void {
    if (entity.creatorUserId !== actorUserId) {
      throw new ForbiddenError(`Only the ${label} owner can perform this action`, {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  /** A veterinarian cannot register for their own course / seminar. */
  assertNotSelf(creatorUserId: string, actorUserId: string): void {
    if (creatorUserId === actorUserId) {
      throw new ForbiddenError('You cannot register for your own course', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  /** You can only register for an APPROVED, not-cancelled course before its registration cutoff. */
  assertRegistrationOpen(course: {
    status: string;
    cancelledAt: string | null;
    registrationDeadline: string | null;
    endDate: string;
  }): void {
    if (course.status !== 'APPROVED' || course.cancelledAt !== null) {
      throw new ConflictError('This course is not open for registration', {
        code: ErrorCode.VET_COURSE_NOT_OPEN,
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = course.registrationDeadline ?? course.endDate;
    if (cutoff < today) {
      throw new ConflictError('The registration deadline for this course has passed', {
        code: ErrorCode.VET_COURSE_NOT_OPEN,
      });
    }
  },

  /** Registrations are capped by `capacity` when the creator set one. */
  assertCapacityAvailable(course: { capacity: number | null }, currentRegistrations: number): void {
    if (course.capacity !== null && currentRegistrations >= course.capacity) {
      throw new ConflictError('This course has reached its registration capacity', {
        code: ErrorCode.VET_COURSE_CAPACITY_FULL,
      });
    }
  },
} as const;
