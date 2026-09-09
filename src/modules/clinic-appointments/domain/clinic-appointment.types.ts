import type {
  ClinicAppointmentActorSide,
  ClinicAppointmentEventKind,
  ClinicAppointmentStatus,
  ClinicAppointmentVisitType,
} from './clinic-appointment.constants.js';

// --- internal aggregates ---------------------------------------------

/**
 * The appointment aggregate. `scheduledFor` is the currently-effective slot
 * (updated in place when a proposed reschedule is accepted). `proposedScheduledFor`
 * holds the clinic's alternative while `status === 'RESCHEDULE_PROPOSED'`.
 */
export interface ClinicAppointment {
  id: string;
  organizationId: string;
  animalId: string;
  petOwnerUserId: string;
  visitType: ClinicAppointmentVisitType;
  /** ISO datetime — the preferred/effective appointment slot. */
  scheduledFor: string;
  /** ISO datetime — the clinic's proposed alternative, or `null`. */
  proposedScheduledFor: string | null;
  note: string | null;
  status: ClinicAppointmentStatus;
  /** Reason attached to a REJECT / decline. */
  decisionReason: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicAppointmentAnimalSummary {
  id: string;
  name: string;
  species: string;
  breed: string | null;
}

export interface ClinicAppointmentOrganizationSummary {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

export interface ClinicAppointmentUserSummary {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ClinicAppointmentHistoryEntry {
  id: string;
  kind: ClinicAppointmentEventKind;
  actorSide: ClinicAppointmentActorSide;
  actorUserId: string | null;
  /** For RESCHEDULE_PROPOSED — the slot that was proposed at that point. */
  fromScheduledFor: string | null;
  toScheduledFor: string | null;
  reason: string | null;
  createdAt: string;
}

// --- API DTOs ------------------------------------------------------

/**
 * Client-safe appointment shape. The joined `animal` / `organization`
 * summaries back both the Pet Owner list card and the future Clinic Dashboard
 * without an N+1. `viewerSide` tells the caller which actions apply.
 */
export interface ClinicAppointmentDTO {
  id: string;
  organizationId: string;
  organization: ClinicAppointmentOrganizationSummary;
  animalId: string;
  animal: ClinicAppointmentAnimalSummary;
  petOwnerUserId: string;
  visitType: ClinicAppointmentVisitType;
  scheduledFor: string;
  proposedScheduledFor: string | null;
  note: string | null;
  status: ClinicAppointmentStatus;
  decisionReason: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  /** The caller's relationship to this appointment. */
  viewerSide: ClinicAppointmentActorSide;
  createdAt: string;
  updatedAt: string;
}

// --- input shapes -------------------------------------------------

export interface CreateClinicAppointmentInput {
  animalId: string;
  visitType: ClinicAppointmentVisitType;
  /** ISO datetime (date + preferred time combined by the client). */
  scheduledFor: string;
  note?: string | null;
}

export interface ProposeRescheduleInput {
  proposedScheduledFor: string;
  reason?: string | null;
}

export interface ClinicAppointmentListFilter {
  page: number;
  pageSize: number;
  status?: ClinicAppointmentStatus;
  /** Clinic-side only: restrict to one pet owner. */
  petOwnerUserId?: string;
  /** Restrict to appointments scheduled on/after this ISO datetime. */
  from?: string;
}

// --- rows -------------------------------------------------------

export interface ClinicAppointmentRow {
  id: string;
  organization_id: string;
  animal_id: string;
  pet_owner_user_id: string;
  visit_type: string;
  scheduled_for: Date;
  proposed_scheduled_for: Date | null;
  note: string | null;
  status: string;
  decision_reason: string | null;
  decided_by_user_id: string | null;
  decided_at: Date | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface ClinicAppointmentEventRow {
  id: string;
  appointment_id: string;
  kind: string;
  actor_side: string;
  actor_user_id: string | null;
  from_scheduled_for: Date | null;
  to_scheduled_for: Date | null;
  reason: string | null;
  created_at: Date;
}

export function rowToClinicAppointment(row: ClinicAppointmentRow): ClinicAppointment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    animalId: row.animal_id,
    petOwnerUserId: row.pet_owner_user_id,
    visitType: row.visit_type as ClinicAppointmentVisitType,
    scheduledFor: row.scheduled_for.toISOString(),
    proposedScheduledFor: row.proposed_scheduled_for
      ? row.proposed_scheduled_for.toISOString()
      : null,
    note: row.note,
    status: row.status as ClinicAppointmentStatus,
    decisionReason: row.decision_reason,
    decidedByUserId: row.decided_by_user_id,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToClinicAppointmentHistoryEntry(
  row: ClinicAppointmentEventRow,
): ClinicAppointmentHistoryEntry {
  return {
    id: row.id,
    kind: row.kind as ClinicAppointmentEventKind,
    actorSide: row.actor_side as ClinicAppointmentActorSide,
    actorUserId: row.actor_user_id,
    fromScheduledFor: row.from_scheduled_for ? row.from_scheduled_for.toISOString() : null,
    toScheduledFor: row.to_scheduled_for ? row.to_scheduled_for.toISOString() : null,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}

export interface ClinicAppointmentJoins {
  animal: ClinicAppointmentAnimalSummary;
  organization: ClinicAppointmentOrganizationSummary;
}

export function toClinicAppointmentDTO(
  appointment: ClinicAppointment,
  joins: ClinicAppointmentJoins,
  viewerSide: ClinicAppointmentActorSide,
): ClinicAppointmentDTO {
  return {
    id: appointment.id,
    organizationId: appointment.organizationId,
    organization: joins.organization,
    animalId: appointment.animalId,
    animal: joins.animal,
    petOwnerUserId: appointment.petOwnerUserId,
    visitType: appointment.visitType,
    scheduledFor: appointment.scheduledFor,
    proposedScheduledFor: appointment.proposedScheduledFor,
    note: appointment.note,
    status: appointment.status,
    decisionReason: appointment.decisionReason,
    decidedByUserId: appointment.decidedByUserId,
    decidedAt: appointment.decidedAt,
    viewerSide,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}
