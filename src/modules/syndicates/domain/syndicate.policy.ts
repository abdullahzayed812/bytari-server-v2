import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { SyndicateSubmissionStatus } from './syndicate.constants.js';

export interface ParentCandidate {
  type: string;
  /** The candidate parent's OWN parent — must be null (max one level of nesting). */
  parentOrganizationId: string | null;
}

/**
 * Pure business rules for Veterinary Syndicates. No I/O. Ownership /
 * membership-permission checks live in `AuthorizationService.canInOrganization`
 * (reused as-is); these are the syndicate-specific invariants.
 */
export const SyndicatePolicy = {
  /**
   * A subordinate syndicate's parent must be an existing MAIN syndicate (a
   * SYNDICATE organization with no parent of its own) — exactly one level of
   * nesting, matching "a main syndicate can have multiple subordinate
   * syndicates" (no branch-of-a-branch).
   */
  assertValidParent(parentId: string, parent: ParentCandidate | null): void {
    if (!parent) {
      throw new NotFoundError('Parent syndicate not found');
    }
    if (parent.type !== 'SYNDICATE') {
      throw new ForbiddenError('The parent must be a syndicate organization', {
        code: ErrorCode.SYNDICATE_PARENT_INVALID,
      });
    }
    if (parent.parentOrganizationId !== null) {
      throw new ForbiddenError('A subordinate syndicate cannot itself have branches', {
        code: ErrorCode.SYNDICATE_PARENT_INVALID,
      });
    }
    void parentId;
  },

  /** Responding is only meaningful once, from PENDING. */
  assertPending(submission: { status: SyndicateSubmissionStatus }): void {
    if (submission.status !== 'PENDING') {
      throw new ConflictError('This submission has already been responded to', {
        code: ErrorCode.SYNDICATE_SUBMISSION_NOT_PENDING,
      });
    }
  },

  /** A CLOSED submission cannot be closed again. */
  assertNotClosed(submission: { status: SyndicateSubmissionStatus }): void {
    if (submission.status === 'CLOSED') {
      throw new ConflictError('This submission is already closed', {
        code: ErrorCode.SYNDICATE_SUBMISSION_NOT_PENDING,
      });
    }
  },
} as const;
