/**
 * Phase 5 — Veterinary Care domain constants.
 *
 * All authorization for this module is ORGANIZATION-scoped (a CLINIC context)
 * plus per-row clinic ownership (`organization_id`). Nothing here is a global
 * permission.
 */

/** Organization types that may hold veterinary access to an animal (Phase 5). */
export const VETERINARY_ORG_TYPES = ['CLINIC'] as const;
export type VeterinaryOrgType = (typeof VETERINARY_ORG_TYPES)[number];

/**
 * Organization-RBAC permission keys introduced by Phase 5. Mirrored into
 * `ORG_PERMISSION_KEYS` / `ORG_PERMISSION_DEFINITIONS` / `ORG_ROLE_PERMISSIONS`
 * in `organization-rbac.constants.ts` (single source of truth for the seed).
 */
export const VETERINARY_CARE_ORG_PERMISSION_KEYS = [
  'animal.veterinary.access.read',
  'animal.veterinary.access.manage',
  'medical_record.read',
  'medical_record.create',
  'medical_record.update',
  'medical_record.delete',
  'vaccination.read',
  'vaccination.create',
  'vaccination.update',
  'vaccination.delete',
] as const;
export type VeterinaryCareOrgPermissionKey = (typeof VETERINARY_CARE_ORG_PERMISSION_KEYS)[number];

// --- Legacy-parity vocabularies (clinic dashboard / pet details migration) ---

/** Legacy `medical_records.severity` (شديدة / متوسطة / خفيفة). */
export const MEDICAL_RECORD_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE'] as const;
export type MedicalRecordSeverity = (typeof MEDICAL_RECORD_SEVERITIES)[number];

/**
 * Legacy `medical_records.record_type`: مراجعة_سريعة → QUICK_REVIEW,
 * فحص_شامل → FULL_EXAM, تحليل → LAB, ملف → FILE; untyped rows → GENERAL.
 */
export const MEDICAL_RECORD_TYPES = [
  'GENERAL',
  'QUICK_REVIEW',
  'FULL_EXAM',
  'LAB',
  'FILE',
] as const;
export type MedicalRecordType = (typeof MEDICAL_RECORD_TYPES)[number];

/** Legacy `vaccinations.status` (overdue is derived, never stored). */
export const VACCINATION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type VaccinationStatus = (typeof VACCINATION_STATUSES)[number];

/** Legacy `pet_reminders.reminder_type`. */
export const REMINDER_TYPES = ['VACCINATION', 'MEDICATION', 'CHECKUP', 'OTHER'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

/** Legacy `clinic_quick_review_templates.template_type`. */
export const QUICK_REVIEW_TEMPLATE_TYPES = [
  'VACCINE',
  'TREATMENT',
  'DIAGNOSIS',
  'GENERAL',
] as const;
export type QuickReviewTemplateType = (typeof QUICK_REVIEW_TEMPLATE_TYPES)[number];

/** Medical attachments: prescription photo + files (legacy `prescriptionImage` / `fileUrls`). */
export const MEDICAL_ATTACHMENT_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export const MEDICAL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const MEDICAL_ATTACHMENTS_MAX = 10;
