import { z } from 'zod';
import { dateTimeSchema } from '../../../shared/validation/date-only.js';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  CLINIC_APPOINTMENT_NOTE_MAX,
  CLINIC_APPOINTMENT_REASON_MAX,
  CLINIC_APPOINTMENT_STATUSES,
  CLINIC_APPOINTMENT_VISIT_TYPES,
} from '../domain/clinic-appointment.constants.js';

/** ISO-8601 instant with offset; month / day / hour may be unpadded (`2026-9-8T14:05Z`). */
const isoDateTime = dateTimeSchema();

export const organizationIdParamSchema = z.object({ organizationId: z.string().uuid() });

export const appointmentIdParamSchema = z.object({ appointmentId: z.string().uuid() });

export const createClinicAppointmentBodySchema = z
  .object({
    animalId: z.string().uuid(),
    visitType: z.enum(CLINIC_APPOINTMENT_VISIT_TYPES),
    scheduledFor: isoDateTime,
    note: z.string().trim().max(CLINIC_APPOINTMENT_NOTE_MAX).optional(),
  })
  .strict();
export type CreateClinicAppointmentBody = z.infer<typeof createClinicAppointmentBodySchema>;

export const listClinicAppointmentsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CLINIC_APPOINTMENT_STATUSES).optional(),
  from: isoDateTime.optional(),
});
export type ListClinicAppointmentsQuery = z.infer<typeof listClinicAppointmentsQuerySchema>;

export const listClinicAppointmentsForClinicQuerySchema = listClinicAppointmentsQuerySchema.extend({
  petOwnerUserId: z.string().uuid().optional(),
});
export type ListClinicAppointmentsForClinicQuery = z.infer<
  typeof listClinicAppointmentsForClinicQuerySchema
>;

/** Pet-owner response to a proposed reschedule. */
export const respondRescheduleBodySchema = z
  .object({
    accept: z.boolean(),
  })
  .strict();
export type RespondRescheduleBody = z.infer<typeof respondRescheduleBodySchema>;

// --- clinic-side (future Clinic Dashboard) --------------------------

export const decisionReasonBodySchema = z
  .object({
    reason: z.string().trim().max(CLINIC_APPOINTMENT_REASON_MAX).optional(),
  })
  .strict();
export type DecisionReasonBody = z.infer<typeof decisionReasonBodySchema>;

export const proposeRescheduleBodySchema = z
  .object({
    proposedScheduledFor: isoDateTime,
    reason: z.string().trim().max(CLINIC_APPOINTMENT_REASON_MAX).optional(),
  })
  .strict();
export type ProposeRescheduleBody = z.infer<typeof proposeRescheduleBodySchema>;

export const updateStatusBodySchema = z
  .object({
    status: z.enum(['CONFIRMED', 'REJECTED', 'COMPLETED', 'CANCELLED']),
    reason: z.string().trim().max(CLINIC_APPOINTMENT_REASON_MAX).optional(),
  })
  .strict();
export type UpdateStatusBody = z.infer<typeof updateStatusBodySchema>;
