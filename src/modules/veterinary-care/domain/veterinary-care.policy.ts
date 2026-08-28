import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
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
