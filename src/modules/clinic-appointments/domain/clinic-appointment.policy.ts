import { BadRequestError, ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { ClinicAppointment } from './clinic-appointment.types.js';
import {
  CLINIC_APPOINTMENT_TERMINAL_STATUSES,
  type ClinicAppointmentStatus,
} from './clinic-appointment.constants.js';

/**
 * Pure business rules for the clinic-appointment workflow. No I/O.
 *
 * Ownership (pet belongs to the caller, caller is on the appointment's pet-owner
 * side) and clinic-membership resolution are enforced in the service against
 * CURRENT state — never from an id in the request body.
 */
export const ClinicAppointmentPolicy = {
  /** Only the pet owner recorded on the appointment may take pet-owner actions. */
  assertPetOwner(appointment: Pick<ClinicAppointment, 'petOwnerUserId'>, actorUserId: string): void {
    if (appointment.petOwnerUserId !== actorUserId) {
      throw new ForbiddenError('Only the pet owner can perform this action on the appointment', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  },

  assertStatus(
    appointment: Pick<ClinicAppointment, 'status'>,
    allowed: readonly ClinicAppointmentStatus[],
    message: string,
  ): void {
    if (!allowed.includes(appointment.status)) {
      throw new ConflictError(message, { code: ErrorCode.CLINIC_APPOINTMENT_INVALID_TRANSITION });
    }
  },

  assertNotTerminal(appointment: Pick<ClinicAppointment, 'status'>): void {
    if (CLINIC_APPOINTMENT_TERMINAL_STATUSES.includes(appointment.status)) {
      throw new ConflictError('This appointment is already closed', {
        code: ErrorCode.CLINIC_APPOINTMENT_INVALID_TRANSITION,
      });
    }
  },

  /**
   * A requested / proposed slot must be in the future. `now` is injectable for
   * tests; never trust a client clock — the value compared is the server's.
   */
  assertSlotInFuture(scheduledForIso: string, now: Date = new Date()): void {
    const slot = new Date(scheduledForIso);
    if (Number.isNaN(slot.getTime())) {
      throw new BadRequestError('Invalid appointment date/time', {
        code: ErrorCode.VALIDATION_ERROR,
      });
    }
    if (slot.getTime() <= now.getTime()) {
      throw new BadRequestError('The appointment date/time must be in the future', {
        code: ErrorCode.CLINIC_APPOINTMENT_IN_PAST,
      });
    }
  },
} as const;
