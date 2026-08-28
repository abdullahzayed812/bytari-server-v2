import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { VETERINARY_STORE_ORG_TYPE } from './store.constants.js';

/**
 * Veterinary Store / product business rules. Pure — no I/O. Services call these.
 */
export const StorePolicy = {
  /**
   * Product management is only available for VETERINARY_STORE organizations
   * (docs 02 §2.3 — "Veterinary Office is an independent entity from stores").
   * The type comes from the resolved organization, never the request body.
   */
  assertVeterinaryStore(org: { type: string }): void {
    if (org.type !== VETERINARY_STORE_ORG_TYPE) {
      throw new BadRequestError('Product management is only available for veterinary stores', {
        code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
      });
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
