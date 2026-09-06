import { ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';

/** Cattle-batch-specific business rules (pure, no I/O). */
export const CattleBatchPolicy = {
  /** A cattle batch must be ACTIVE for updates (a CLOSED batch is historical). */
  assertBatchMutable(batch: { status: string }): void {
    if (batch.status !== 'ACTIVE') {
      throw new ConflictError('This cattle batch is closed and cannot be modified', {
        code: ErrorCode.CATTLE_BATCH_NOT_ACTIVE,
      });
    }
  },
} as const;
