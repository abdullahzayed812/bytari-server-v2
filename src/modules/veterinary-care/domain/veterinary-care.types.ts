import type { ClinicAccessStatus } from './veterinary-care.constants.js';

// --- internal aggregates ------------------------------------------------

export interface ClinicAnimalAccess {
  id: string;
  animalId: string;
  organizationId: string;
  status: ClinicAccessStatus;
  grantedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MedicalRecord {
  id: string;
  animalId: string;
  organizationId: string;
  recordedByUserId: string | null;
  visitDate: string;
  reason: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vaccination {
  id: string;
  animalId: string;
  organizationId: string;
  recordedByUserId: string | null;
  vaccineName: string;
  administeredOn: string;
  nextDueOn: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- API DTOs ---------------------------------------------------------
//
// The clinic-facing and owner-facing DTOs are intentionally SEPARATE types even
// though they currently expose the same fields: the product spec does not yet
// define field-level owner visibility, so owner redaction can be added later by
// changing only `toOwnerMedicalRecordDTO` / `toOwnerVaccinationDTO` — never the
// authorization layer.

export interface MedicalRecordDTO {
  id: string;
  animalId: string;
  organizationId: string;
  recordedByUserId: string | null;
  visitDate: string;
  reason: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaccinationDTO {
  id: string;
  animalId: string;
  organizationId: string;
  recordedByUserId: string | null;
  vaccineName: string;
  administeredOn: string;
  nextDueOn: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicAnimalAccessDTO {
  id: string;
  animalId: string;
  organizationId: string;
  status: ClinicAccessStatus;
  grantedByUserId: string | null;
  createdAt: string;
}

// --- medical history / timeline (Phase 8) --------------------------
//
// A COMPOSED read model over `medical_records` + `vaccinations` — no new table,
// no data duplication. One chronological view of the animal's medical history
// (docs 04 §4.4 "Medical History", §4.5 "Vaccination History").

export type MedicalTimelineEntryType = 'MEDICAL_RECORD' | 'VACCINATION';

export interface MedicalTimelineEntryDTO {
  type: MedicalTimelineEntryType;
  /** `visitDate` for a record, `administeredOn` for a vaccination (YYYY-MM-DD). */
  occurredOn: string;
  organizationId: string;
  recordedByUserId: string | null;
  createdAt: string;
  medicalRecord?: MedicalRecordDTO;
  vaccination?: VaccinationDTO;
}

export function medicalRecordToTimelineEntry(r: MedicalRecordDTO): MedicalTimelineEntryDTO {
  return {
    type: 'MEDICAL_RECORD',
    occurredOn: r.visitDate,
    organizationId: r.organizationId,
    recordedByUserId: r.recordedByUserId,
    createdAt: r.createdAt,
    medicalRecord: r,
  };
}

export function vaccinationToTimelineEntry(v: VaccinationDTO): MedicalTimelineEntryDTO {
  return {
    type: 'VACCINATION',
    occurredOn: v.administeredOn,
    organizationId: v.organizationId,
    recordedByUserId: v.recordedByUserId,
    createdAt: v.createdAt,
    vaccination: v,
  };
}

/** Newest first: by `occurredOn`, then `createdAt` as a stable tie-break. */
export function sortTimelineEntries(entries: MedicalTimelineEntryDTO[]): MedicalTimelineEntryDTO[] {
  return [...entries].sort((a, b) => {
    if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return 0;
  });
}

// --- input shapes ---------------------------------------------------

export interface CreateMedicalRecordInput {
  visitDate?: string;
  reason?: string | null;
  diagnosis?: string | null;
  treatment?: string | null;
  notes?: string | null;
}
export type UpdateMedicalRecordInput = CreateMedicalRecordInput;

export interface CreateVaccinationInput {
  vaccineName: string;
  administeredOn: string;
  nextDueOn?: string | null;
  notes?: string | null;
}
export interface UpdateVaccinationInput {
  vaccineName?: string;
  administeredOn?: string;
  nextDueOn?: string | null;
  notes?: string | null;
}

export interface ListMedicalRecordsFilter {
  page: number;
  pageSize: number;
  /** When set, restrict to records recorded by this clinic. */
  organizationId?: string;
}

export interface ListVaccinationsFilter {
  page: number;
  pageSize: number;
  organizationId?: string;
  /** ISO date — only vaccinations whose `nextDueOn` is on/after this date. */
  dueFrom?: string;
}

// --- rows -----------------------------------------------------------

export interface ClinicAnimalAccessRow {
  id: string;
  animal_id: string;
  organization_id: string;
  status: string;
  granted_by_user_id: string | null;
  revoked_by_user_id: string | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MedicalRecordRow {
  id: string;
  animal_id: string;
  organization_id: string;
  recorded_by_user_id: string | null;
  visit_date: string | Date;
  reason: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface VaccinationRow {
  id: string;
  animal_id: string;
  organization_id: string;
  recorded_by_user_id: string | null;
  vaccine_name: string;
  administered_on: string | Date;
  next_due_on: string | Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function rowToClinicAnimalAccess(row: ClinicAnimalAccessRow): ClinicAnimalAccess {
  return {
    id: row.id,
    animalId: row.animal_id,
    organizationId: row.organization_id,
    status: row.status as ClinicAccessStatus,
    grantedByUserId: row.granted_by_user_id,
    revokedByUserId: row.revoked_by_user_id,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToMedicalRecord(row: MedicalRecordRow): MedicalRecord {
  return {
    id: row.id,
    animalId: row.animal_id,
    organizationId: row.organization_id,
    recordedByUserId: row.recorded_by_user_id,
    visitDate: dateOnly(row.visit_date) as string,
    reason: row.reason,
    diagnosis: row.diagnosis,
    treatment: row.treatment,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToVaccination(row: VaccinationRow): Vaccination {
  return {
    id: row.id,
    animalId: row.animal_id,
    organizationId: row.organization_id,
    recordedByUserId: row.recorded_by_user_id,
    vaccineName: row.vaccine_name,
    administeredOn: dateOnly(row.administered_on) as string,
    nextDueOn: dateOnly(row.next_due_on),
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toMedicalRecordDTO(r: MedicalRecord): MedicalRecordDTO {
  return { ...r };
}
export function toVaccinationDTO(v: Vaccination): VaccinationDTO {
  return { ...v };
}
/** Owner-facing projection. Same fields today; the seam for future redaction. */
export function toOwnerMedicalRecordDTO(r: MedicalRecord): MedicalRecordDTO {
  return toMedicalRecordDTO(r);
}
export function toOwnerVaccinationDTO(v: Vaccination): VaccinationDTO {
  return toVaccinationDTO(v);
}
export function toClinicAnimalAccessDTO(a: ClinicAnimalAccess): ClinicAnimalAccessDTO {
  return {
    id: a.id,
    animalId: a.animalId,
    organizationId: a.organizationId,
    status: a.status,
    grantedByUserId: a.grantedByUserId,
    createdAt: a.createdAt,
  };
}
