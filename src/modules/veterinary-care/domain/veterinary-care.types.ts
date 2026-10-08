import type {
  MedicalRecordSeverity,
  MedicalRecordType,
  QuickReviewTemplateType,
  ReminderType,
  VaccinationStatus,
} from './veterinary-care.constants.js';

// --- internal aggregates ------------------------------------------------

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
  symptoms: string | null;
  severity: MedicalRecordSeverity | null;
  labNotes: string | null;
  recordType: MedicalRecordType;
  isDraft: boolean;
  /** R2 key of the prescription photo (legacy `prescriptionImage`). */
  prescriptionKey: string | null;
  /** R2 keys of attached images / PDFs (legacy `fileUrls`). */
  attachmentKeys: string[];
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
  status: VaccinationStatus;
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
  symptoms: string | null;
  severity: MedicalRecordSeverity | null;
  labNotes: string | null;
  recordType: MedicalRecordType;
  isDraft: boolean;
  prescriptionKey: string | null;
  /** Resolved (signed) URL for {@link prescriptionKey}. */
  prescriptionUrl: string | null;
  attachmentKeys: string[];
  /** Resolved (signed) URLs, same order as {@link attachmentKeys}. */
  attachmentUrls: string[];
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
  status: VaccinationStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
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
  symptoms?: string | null;
  severity?: MedicalRecordSeverity | null;
  labNotes?: string | null;
  recordType?: MedicalRecordType;
  isDraft?: boolean;
  prescriptionKey?: string | null;
  attachmentKeys?: string[];
}
export type UpdateMedicalRecordInput = CreateMedicalRecordInput;

export interface CreateVaccinationInput {
  vaccineName: string;
  administeredOn: string;
  nextDueOn?: string | null;
  status?: VaccinationStatus;
  notes?: string | null;
}
export interface UpdateVaccinationInput {
  vaccineName?: string;
  administeredOn?: string;
  nextDueOn?: string | null;
  status?: VaccinationStatus;
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

/** Clinic-wide vaccination list ("التطعيمات"): `OVERDUE` = SCHEDULED with `nextDueOn` < today. */
export type ClinicVaccinationListStatus = 'ALL' | VaccinationStatus | 'OVERDUE' | 'DUE_TODAY';

// --- rows -----------------------------------------------------------

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
  symptoms: string | null;
  severity: string | null;
  lab_notes: string | null;
  record_type: string;
  is_draft: boolean;
  prescription_key: string | null;
  attachment_keys: string[] | null;
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
  status: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
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
    symptoms: row.symptoms,
    severity: row.severity as MedicalRecordSeverity | null,
    labNotes: row.lab_notes,
    recordType: row.record_type as MedicalRecordType,
    isDraft: row.is_draft,
    prescriptionKey: row.prescription_key,
    attachmentKeys: row.attachment_keys ?? [],
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
    status: row.status as VaccinationStatus,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * `urls` resolves the record's R2 keys (signed GET URLs) — the service layer
 * owns storage, so the mapper only stitches them in.
 */
export function toMedicalRecordDTO(
  r: MedicalRecord,
  urls: { prescriptionUrl: string | null; attachmentUrls: string[] } = {
    prescriptionUrl: null,
    attachmentUrls: [],
  },
): MedicalRecordDTO {
  return { ...r, ...urls };
}
export function toVaccinationDTO(v: Vaccination): VaccinationDTO {
  return { ...v };
}
/** Owner-facing projection of an OWNER-VISIBLE vaccination (read-only). */
export function toOwnerVaccinationDTO(v: Vaccination): VaccinationDTO {
  return toVaccinationDTO(v);
}
// --- reminders (legacy `pet_reminders`) ------------------------------

export interface AnimalReminder {
  id: string;
  animalId: string;
  organizationId: string;
  recordedByUserId: string | null;
  title: string;
  description: string | null;
  /** YYYY-MM-DD */
  reminderDate: string;
  reminderType: ReminderType;
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type AnimalReminderDTO = AnimalReminder;

export interface AnimalReminderRow {
  id: string;
  animal_id: string;
  organization_id: string;
  recorded_by_user_id: string | null;
  title: string;
  description: string | null;
  reminder_date: string | Date;
  reminder_type: string;
  is_completed: boolean;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToAnimalReminder(row: AnimalReminderRow): AnimalReminder {
  return {
    id: row.id,
    animalId: row.animal_id,
    organizationId: row.organization_id,
    recordedByUserId: row.recorded_by_user_id,
    title: row.title,
    description: row.description,
    reminderDate: dateOnly(row.reminder_date) as string,
    reminderType: row.reminder_type as ReminderType,
    isCompleted: row.is_completed,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateReminderInput {
  title: string;
  description?: string | null;
  reminderDate: string;
  reminderType?: ReminderType;
}
export interface UpdateReminderInput {
  title?: string;
  description?: string | null;
  reminderDate?: string;
  reminderType?: ReminderType;
  isCompleted?: boolean;
}

/** Clinic-wide reminder list: `OVERDUE` = not completed and `reminderDate` < today. */
export type ClinicReminderListStatus = 'ALL' | 'PENDING' | 'OVERDUE' | 'COMPLETED' | 'TODAY';

// --- quick-review templates (legacy `clinic_quick_review_templates`) -----

export interface QuickReviewTemplate {
  id: string;
  organizationId: string;
  name: string;
  templateType: QuickReviewTemplateType;
  defaultDiagnosis: string | null;
  defaultTreatment: string | null;
  defaultNotes: string | null;
  intervalDays: number | null;
  createdAt: string;
  updatedAt: string;
}
export type QuickReviewTemplateDTO = QuickReviewTemplate;

export interface QuickReviewTemplateRow {
  id: string;
  organization_id: string;
  name: string;
  template_type: string;
  default_diagnosis: string | null;
  default_treatment: string | null;
  default_notes: string | null;
  interval_days: number | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToQuickReviewTemplate(row: QuickReviewTemplateRow): QuickReviewTemplate {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    templateType: row.template_type as QuickReviewTemplateType,
    defaultDiagnosis: row.default_diagnosis,
    defaultTreatment: row.default_treatment,
    defaultNotes: row.default_notes,
    intervalDays: row.interval_days,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface QuickReviewTemplateInput {
  name: string;
  templateType?: QuickReviewTemplateType;
  defaultDiagnosis?: string | null;
  defaultTreatment?: string | null;
  defaultNotes?: string | null;
  intervalDays?: number | null;
}

/**
 * One row of a clinic-wide list (vaccinations / reminders): the item plus the
 * animal summary and — like the legacy clinic screens — the owner's display
 * name and phone, only ever returned for animals the clinic holds ACTIVE
 * access to.
 */
export interface ClinicListAnimalSummary {
  id: string;
  name: string;
  species: string;
  breed: string | null;
}
export interface ClinicListOwnerSummary {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}
