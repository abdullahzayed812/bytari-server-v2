import { ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { SupportThread } from './thread.types.js';

/**
 * Pure thread-lifecycle rules. Anything needing the database (who the caller
 * is, permission resolution) lives in the service.
 */
export const ThreadPolicy = {
  /** The creator may post only while OPEN and not blocked (UC-023 / UC-027). */
  assertCreatorMayPost(thread: SupportThread): void {
    if (thread.status === 'CLOSED') {
      throw new ConflictError('This thread is closed', {
        code: ErrorCode.THREAD_NOT_WRITABLE,
      });
    }
    if (thread.senderBlockedAt !== null) {
      throw new ForbiddenError('You can no longer send messages in this thread', {
        code: ErrorCode.THREAD_NOT_WRITABLE,
      });
    }
  },

  /** A responder (supervisor / admin) may post only while OPEN. */
  assertResponderMayPost(thread: SupportThread): void {
    if (thread.status === 'CLOSED') {
      throw new ConflictError('This thread is closed', {
        code: ErrorCode.THREAD_NOT_WRITABLE,
      });
    }
  },
} as const;
