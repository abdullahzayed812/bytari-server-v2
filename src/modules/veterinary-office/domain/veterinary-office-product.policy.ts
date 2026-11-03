import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  PRODUCT_CATALOG_ORG_TYPES,
  VETERINARY_OFFICE_ORG_TYPE,
} from './veterinary-office-product.constants.js';

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
   * The product catalogue + store (Veterinary Office Store, Clinic Store) is
   * available to VETERINARY_OFFICE and CLINIC organizations. Anything else —
   * including a VETERINARY_STORE, whose catalogue is the separate
   * `veterinary-store` module — is rejected the same way.
   */
  assertStoreOrganization(org: { type: string }): void {
    if (!(PRODUCT_CATALOG_ORG_TYPES as readonly string[]).includes(org.type)) {
      throw new BadRequestError(
        'Product management is only available for veterinary offices and clinics',
        { code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED },
      );
    }
  },
} as const;
