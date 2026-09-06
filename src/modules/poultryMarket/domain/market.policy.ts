import { ForbiddenError, BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';

/**
 * Poultry/egg market business rules shared across both offer kinds — pure, no
 * I/O. Services call these; the gallery-limit / ownership rules are identical
 * for poultry and egg offers even though the two live in separate tables.
 */
export const MarketPolicy = {
  /** A trader may manage only their own offer; ADMIN/MARKET-supervisor bypass via the route guard. */
  assertOwner(offer: { traderUserId: string }, actorUserId: string): void {
    if (offer.traderUserId !== actorUserId) {
      throw new ForbiddenError('You can only manage your own offer', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  assertGalleryLimit(keys: string[], max: number): void {
    if (keys.length > max) {
      throw new BadRequestError(`an offer may have at most ${max} photos`, {
        code: ErrorCode.GALLERY_LIMIT_EXCEEDED,
      });
    }
  },
} as const;
