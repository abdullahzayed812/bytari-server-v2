import { ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { AnimalPublication } from './publication.types.js';

/**
 * Animal-publication business rules. Pure — no I/O. Services call these.
 */
export const PublicationPolicy = {
  /**
   * The publisher MUST be the animal's current owner (spec §18). The owner id
   * comes from `animal_ownerships`, never the request body. This is a
   * service-layer backstop — the route already enforces owner-only access
   * (returning 404 to non-owners, matching the Phase 4 resource-hiding rule).
   */
  assertIsCurrentOwner(animal: { currentOwnerUserId: string | null }, actorUserId: string): void {
    if (animal.currentOwnerUserId !== actorUserId) {
      throw new ForbiddenError('Only the animal owner can publish this animal', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  /** The animal must be ACTIVE to be published (mirrors AnimalPolicy). */
  assertAnimalActive(animal: { status: string }): void {
    if (animal.status !== 'ACTIVE') {
      throw new ConflictError('The animal is deactivated and cannot be published', {
        code: ErrorCode.ANIMAL_NOT_ACTIVE,
      });
    }
  },

  /** Moderation transitions apply only to a PENDING publication. */
  assertPending(publication: Pick<AnimalPublication, 'status'>): void {
    if (publication.status !== 'PENDING') {
      throw new ConflictError('This publication has already been reviewed', {
        code: ErrorCode.PUBLICATION_NOT_PENDING,
      });
    }
  },
} as const;
