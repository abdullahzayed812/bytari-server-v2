import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { PRODUCT_ORG_TYPES } from './store.constants.js';

/**
 * Veterinary Store / Veterinary Office product business rules. Pure — no I/O.
 * Services call these.
 */
export const StorePolicy = {
  /**
   * Product management is only available for VETERINARY_STORE / VETERINARY_OFFICE
   * organizations. The type comes from the resolved organization, never the
   * request body.
   */
  assertProductCapable(org: { type: string }): void {
    if (!(PRODUCT_ORG_TYPES as readonly string[]).includes(org.type)) {
      throw new BadRequestError(
        'Product management is only available for veterinary stores and veterinary offices',
        { code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED },
      );
    }
  },

  /**
   * Apply a signed stock delta and assert the result is not negative
   * (also guarded by the `chk_products_stock` DB CHECK — this gives a clean 409).
   */
  applyStockDelta(current: number, delta: number): number {
    const next = current + delta;
    if (next < 0) {
      throw new ConflictError('The adjustment would take stock below zero', {
        code: ErrorCode.INSUFFICIENT_STOCK,
      });
    }
    return next;
  },
} as const;
