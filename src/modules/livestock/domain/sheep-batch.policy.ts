import { ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';

/** Sheep-batch-specific business rules (pure, no I/O). */
export const SheepBatchPolicy = {
  /** A sheep batch must be ACTIVE for updates (a CLOSED batch is historical). */
  assertBatchMutable(batch: { status: string }): void {
    if (batch.status !== 'ACTIVE') {
      throw new ConflictError('This sheep batch is closed and cannot be modified', {
        code: ErrorCode.SHEEP_BATCH_NOT_ACTIVE,
      });
    }
  },
} as const;
