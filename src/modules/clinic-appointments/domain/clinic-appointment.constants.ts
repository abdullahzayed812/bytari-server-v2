/**
 * Clinic Appointments domain constants — the Pet Owner ↔ Clinic appointment
 * request/booking workflow behind the "حجز موعد" screen.
 *
 * Text + CHECK enums (not catalogue tables), mirrored by the DB CHECK
 * constraints in `20260921010000_clinic_appointments.ts` and re-encoded
 * independently by the Zod schemas. Extend via migration.
 *
 * Access model mirrors chat's PET_OWNER_CLINIC relationship (docs §35/§36):
 *  - the PET OWNER side is `clinic_appointments.pet_owner_user_id`;
 *  - the CLINIC side is resolved live from `organization_memberships`
 *    (any ACTIVE member of the clinic organization) — no stored row.
 */

/** Visit type ("نوع الزيارة" chips). Text + CHECK — extend via migration. */
export const CLINIC_APPOINTMENT_VISIT_TYPES = [
  'CHECKUP', // فحص
  'VACCINATION', // تطعيم
  'FOLLOW_UP', // مراجعة
  'SURGERY', // جراحة
  'OTHER', // أخرى
] as const;
export type ClinicAppointmentVisitType = (typeof CLINIC_APPOINTMENT_VISIT_TYPES)[number];

/**
 * Appointment lifecycle. The future Clinic Dashboard drives
 * PENDING → CONFIRMED / REJECTED / RESCHEDULE_PROPOSED and CONFIRMED →
 * COMPLETED; the Pet Owner drives create (→ PENDING), CANCELLED, and the
 * response to a proposed reschedule (accept → CONFIRMED, decline → CANCELLED).
 */
export const CLINIC_APPOINTMENT_STATUSES = [
  'PENDING', // في الانتظار
  'CONFIRMED', // المؤكدة
  'RESCHEDULE_PROPOSED', // اقتراح بديل
  'COMPLETED', // مكتملة
  'REJECTED', // مرفوضة
  'CANCELLED', // ملغاة
] as const;
export type ClinicAppointmentStatus = (typeof CLINIC_APPOINTMENT_STATUSES)[number];

/** Statuses in which the appointment is still "open" (no terminal decision). */
export const CLINIC_APPOINTMENT_OPEN_STATUSES: readonly ClinicAppointmentStatus[] = [
  'PENDING',
  'CONFIRMED',
  'RESCHEDULE_PROPOSED',
];

/** Terminal statuses — no further transition is allowed. */
export const CLINIC_APPOINTMENT_TERMINAL_STATUSES: readonly ClinicAppointmentStatus[] = [
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];

/**
 * Who performed a lifecycle transition — recorded on every
 * `clinic_appointment_events` row so the Clinic Dashboard can render a history
 * timeline ("طلبته: أنت" vs the clinic).
 */
export const CLINIC_APPOINTMENT_ACTOR_SIDES = ['PET_OWNER', 'CLINIC'] as const;
export type ClinicAppointmentActorSide = (typeof CLINIC_APPOINTMENT_ACTOR_SIDES)[number];

/**
 * History event kinds (`clinic_appointment_events.kind`). One row per state
 * change; `REQUESTED` is the creation row.
 */
export const CLINIC_APPOINTMENT_EVENT_KINDS = [
  'REQUESTED',
  'CONFIRMED',
  'REJECTED',
  'RESCHEDULE_PROPOSED',
  'RESCHEDULE_ACCEPTED',
  'RESCHEDULE_DECLINED',
  'CANCELLED',
  'COMPLETED',
] as const;
export type ClinicAppointmentEventKind = (typeof CLINIC_APPOINTMENT_EVENT_KINDS)[number];

/**
 * Audit actions / entity types for clinic appointments. `AuditService` takes
 * free-form strings (see `audit.types.ts`), so — like the poultry-ops and
 * content-tips modules — these live with the domain rather than the central
 * catalogue.
 */
export const ClinicAppointmentAuditAction = {
  CLINIC_APPOINTMENT_REQUESTED: 'CLINIC_APPOINTMENT_REQUESTED',
  CLINIC_APPOINTMENT_CONFIRMED: 'CLINIC_APPOINTMENT_CONFIRMED',
  CLINIC_APPOINTMENT_REJECTED: 'CLINIC_APPOINTMENT_REJECTED',
  CLINIC_APPOINTMENT_RESCHEDULE_PROPOSED: 'CLINIC_APPOINTMENT_RESCHEDULE_PROPOSED',
  CLINIC_APPOINTMENT_RESCHEDULE_ACCEPTED: 'CLINIC_APPOINTMENT_RESCHEDULE_ACCEPTED',
  CLINIC_APPOINTMENT_RESCHEDULE_DECLINED: 'CLINIC_APPOINTMENT_RESCHEDULE_DECLINED',
  CLINIC_APPOINTMENT_CANCELLED: 'CLINIC_APPOINTMENT_CANCELLED',
  CLINIC_APPOINTMENT_COMPLETED: 'CLINIC_APPOINTMENT_COMPLETED',
  CLINIC_APPOINTMENT_STATUS_UPDATED: 'CLINIC_APPOINTMENT_STATUS_UPDATED',
} as const;

export const ClinicAppointmentAuditEntity = {
  CLINIC_APPOINTMENT: 'CLINIC_APPOINTMENT',
} as const;

/** Domain event names (published on the in-process bus, consumed by notifications). */
export const ClinicAppointmentEvent = {
  REQUESTED: 'clinic.appointment.requested',
  CONFIRMED: 'clinic.appointment.confirmed',
  REJECTED: 'clinic.appointment.rejected',
  RESCHEDULE_PROPOSED: 'clinic.appointment.reschedule_proposed',
  RESCHEDULE_ACCEPTED: 'clinic.appointment.reschedule_accepted',
  RESCHEDULE_DECLINED: 'clinic.appointment.reschedule_declined',
  CANCELLED: 'clinic.appointment.cancelled',
  COMPLETED: 'clinic.appointment.completed',
} as const;

/** Free-text note cap (matches the app's textarea + Zod). */
export const CLINIC_APPOINTMENT_NOTE_MAX = 1000;
/** Decision-reason cap for reject / decline. */
export const CLINIC_APPOINTMENT_REASON_MAX = 500;
