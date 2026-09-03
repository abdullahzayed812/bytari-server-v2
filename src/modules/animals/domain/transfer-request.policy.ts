import { ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { AnimalTransferRequest } from './transfer-request.types.js';

/** Pure business rules for the request/acceptance transfer workflow. No I/O. */
export const TransferRequestPolicy = {
  assertPending(request: Pick<AnimalTransferRequest, 'status'>): void {
    if (request.status !== 'PENDING') {
      throw new ConflictError('This transfer request has already been resolved', {
        code: ErrorCode.TRANSFER_REQUEST_NOT_PENDING,
      });
    }
  },

  /** Only the recipient may accept or reject. */
  assertRecipient(request: Pick<AnimalTransferRequest, 'toUserId'>, actorUserId: string): void {
    if (request.toUserId !== actorUserId) {
      throw new ForbiddenError('Only the recipient can respond to this transfer request', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  /** Only the sender may cancel their own request. */
  assertSender(request: Pick<AnimalTransferRequest, 'fromUserId'>, actorUserId: string): void {
    if (request.fromUserId !== actorUserId) {
      throw new ForbiddenError('Only the sender can cancel this transfer request', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },
} as const;
