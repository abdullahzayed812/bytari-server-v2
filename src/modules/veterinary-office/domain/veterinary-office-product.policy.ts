import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { VETERINARY_OFFICE_ORG_TYPE } from './veterinary-office-product.constants.js';

/** Veterinary Office product business rules. Pure — no I/O. Services call these. */
export const VeterinaryOfficeProductPolicy = {
  /**
   * Product management is only available for VETERINARY_OFFICE organizations.
   * A Veterinary Store is a fully separate domain (`veterinary-store`) —
   * never this one. The type comes from the resolved organization, never the
   * request body.
   */
  assertVeterinaryOffice(org: { type: string }): void {
    if (org.type !== VETERINARY_OFFICE_ORG_TYPE) {
      throw new BadRequestError('Product management is only available for veterinary offices', {
        code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
      });
    }
  },

  /**
   * Apply a signed stock delta and assert the result is not negative
   * (also guarded by the `chk_vop_stock` DB CHECK — this gives a clean 409).
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
