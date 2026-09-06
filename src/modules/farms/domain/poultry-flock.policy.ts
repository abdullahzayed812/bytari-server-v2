import { ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';

/** Poultry-flock-specific business rules (pure, no I/O). */
export const PoultryFlockPolicy = {
  /** A poultry flock must be ACTIVE for updates (a CLOSED batch is historical). */
  assertFlockMutable(flock: { status: string }): void {
    if (flock.status !== 'ACTIVE') {
      throw new ConflictError('This poultry flock is closed and cannot be modified', {
        code: ErrorCode.POULTRY_FLOCK_NOT_ACTIVE,
      });
    }
  },
} as const;
