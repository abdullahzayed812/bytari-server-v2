import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { VETERINARY_ORG_TYPES } from './veterinary-care.constants.js';

/**
 * Veterinary-care business rules. Pure — no I/O. Services call these; controllers
 * and repositories do not.
 */
export const VeterinaryCarePolicy = {
  /**
   * Veterinary access + medical records are, in Phase 5, only defined for
   * CLINIC organizations (docs 01 §1.3.3, docs 05 UC-016). Other organization
   * types are an explicit future extension point.
   */
  assertVeterinaryOrgType(org: { type: string }): void {
    if (!(VETERINARY_ORG_TYPES as readonly string[]).includes(org.type)) {
      throw new BadRequestError('Veterinary access is only available for clinic organizations', {
        code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
      });
    }
  },

  /**
   * Only registered (owned) pet profiles can be clinic patients. A lost /
   * adoption / mating listing subject (`listing_only`) is a separate public
   * domain — it is reported as "not found" so its existence is not revealed.
   */
  assertRegisteredPet(animal: { listingOnly: boolean }): void {
    if (animal.listingOnly) throw new NotFoundError('Animal not found');
  },

  /**
   * Shared vaccinations / reminders: every clinic may READ them, only the
   * clinic that created them may change, delete or notify about them. Rows
   * detached by "remove pet from clinic" (`organizationId` null) belong to
   * no clinic any more and are read-only for everyone. A row of another
   * animal is a plain 404 (IDOR guard is the caller's lookup).
   */
  assertClinicOwnsSharedItem(
    item: { organizationId: string | null },
    organizationId: string,
  ): void {
    if (item.organizationId !== organizationId) {
      throw new ForbiddenError('Only the clinic that created this item can change it', {
        code: ErrorCode.CLINIC_RECORD_NOT_OWNED,
      });
    }
  },

  /** Medical writes require the animal to be ACTIVE (mirrors AnimalPolicy). */
  assertAnimalActive(animal: { status: string }): void {
    if (animal.status !== 'ACTIVE') {
      throw new ConflictError('The animal is deactivated and cannot be modified', {
        code: ErrorCode.ANIMAL_NOT_ACTIVE,
      });
    }
  },

  /**
   * A vaccination's next-due date cannot precede the date it was administered
   * (also enforced by the `chk_vaccinations_due_after` DB CHECK — this gives a
   * clean 400 instead of a constraint error).
   */
  assertVaccinationDates(administeredOn: string, nextDueOn: string | null | undefined): void {
    if (nextDueOn != null && nextDueOn < administeredOn) {
      throw new BadRequestError('nextDueOn cannot be earlier than administeredOn');
    }
  },
} as const;
