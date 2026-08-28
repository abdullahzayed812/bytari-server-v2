import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { Animal } from './animal.types.js';

/**
 * Animal Core business rules. Pure — no I/O. Services call these; controllers do not.
 */
export const AnimalPolicy = {
  /** An animal must be ACTIVE for mutations / ownership transfer. */
  assertMutable(animal: Pick<Animal, 'status'>): void {
    if (animal.status !== 'ACTIVE') {
      throw new ConflictError('The animal is deactivated and cannot be modified', {
        code: ErrorCode.ANIMAL_NOT_ACTIVE,
      });
    }
  },

  /**
   * Validate an ownership-transfer target (spec §4). `target` is `null` when the
   * user id does not exist.
   */
  assertValidTransferTarget(
    target: { id: string; status: string } | null,
    currentOwnerUserId: string,
  ): void {
    if (!target) {
      throw new NotFoundError('Target user not found');
    }
    if (target.status !== 'ACTIVE') {
      throw new BadRequestError('Target user is not active', {
        code: ErrorCode.INVALID_TRANSFER_TARGET,
      });
    }
    if (target.id === currentOwnerUserId) {
      throw new ConflictError('Target user is already the current owner', {
        code: ErrorCode.INVALID_TRANSFER_TARGET,
      });
    }
  },
} as const;
