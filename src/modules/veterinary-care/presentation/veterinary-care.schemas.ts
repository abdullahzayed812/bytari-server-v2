import { z } from 'zod';
import { businessToday } from '../../../shared/time/business-date.js';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  MEDICAL_ATTACHMENTS_MAX,
  MEDICAL_RECORD_SEVERITIES,
  MEDICAL_RECORD_TYPES,
  QUICK_REVIEW_TEMPLATE_TYPES,
  REMINDER_TYPES,
  VACCINATION_STATUSES,
} from '../domain/veterinary-care.constants.js';

/** `YYYY-MM-DD`, a real calendar date, not in the future. */
const pastOrTodayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)) && v <= businessToday(), 'Invalid or future date');

/** `YYYY-MM-DD`, a real calendar date (may be in the future — e.g. next-due). */
const anyDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

const shortText = z.string().trim().min(1).max(2000);
const longText = z.string().trim().min(1).max(8000);

// --- clinic pets (record-derived, no link) ------------------------------

/** `{ organizationId, animalId }` — clinic-scoped animal sub-resources. */
export const clinicAnimalParamSchema = z.object({
  organizationId: z.string().uuid(),
  animalId: z.string().uuid(),
});

/**
 * `GET /organizations/:id/clinic-pets` — `search` matches the full id or the
 * short public ID exactly, or the name / breed / species / current owner's
 * name / phone (ILIKE) — ONLY among pets this clinic has its own records for.
 */
export const listClinicPetsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
});

/** `GET /organizations/:id/clinic-pets/lookup?code=` — short public ID or (legacy QR) UUID / link. */
export const clinicPetLookupQuerySchema = z.object({
  code: z.string().trim().min(1).max(300),
});

// --- medical records ------------------------------------------------

const storageKey = z.string().trim().min(1).max(1000);

const medicalRecordFields = {
  visitDate: pastOrTodayDate.optional(),
  reason: shortText.nullable().optional(),
  diagnosis: longText.nullable().optional(),
  treatment: longText.nullable().optional(),
  notes: longText.nullable().optional(),
  // --- legacy full-exam / lab / file fields ---
  symptoms: longText.nullable().optional(),
  severity: z.enum(MEDICAL_RECORD_SEVERITIES).nullable().optional(),
  labNotes: longText.nullable().optional(),
  recordType: z.enum(MEDICAL_RECORD_TYPES).optional(),
  isDraft: z.boolean().optional(),
  prescriptionKey: storageKey.nullable().optional(),
  attachmentKeys: z.array(storageKey).max(MEDICAL_ATTACHMENTS_MAX).optional(),
};

export const createMedicalRecordBodySchema = z
  .object(medicalRecordFields)
  .refine(
    (v) =>
      v.reason != null ||
      v.diagnosis != null ||
      v.treatment != null ||
      v.notes != null ||
      v.symptoms != null ||
      v.labNotes != null ||
      v.prescriptionKey != null ||
      (v.attachmentKeys?.length ?? 0) > 0,
    {
      message:
        'Provide at least one of reason, diagnosis, treatment, notes, symptoms, lab notes or an attachment',
    },
  );
export type CreateMedicalRecordBody = z.infer<typeof createMedicalRecordBodySchema>;

export const updateMedicalRecordBodySchema = z
  .object(medicalRecordFields)
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateMedicalRecordBody = z.infer<typeof updateMedicalRecordBodySchema>;

export const medicalRecordParamSchema = z.object({
  organizationId: z.string().uuid(),
  animalId: z.string().uuid(),
  recordId: z.string().uuid(),
});

export const listMedicalRecordsQuerySchema = paginationQuerySchema;

// --- vaccinations -------------------------------------------------

export const createVaccinationBodySchema = z.object({
  vaccineName: z.string().trim().min(1).max(200),
  administeredOn: pastOrTodayDate,
  nextDueOn: anyDate.nullable().optional(),
  status: z.enum(VACCINATION_STATUSES).optional(),
  notes: longText.nullable().optional(),
});
export type CreateVaccinationBody = z.infer<typeof createVaccinationBodySchema>;

export const updateVaccinationBodySchema = z
  .object({
    vaccineName: z.string().trim().min(1).max(200).optional(),
    administeredOn: pastOrTodayDate.optional(),
    nextDueOn: anyDate.nullable().optional(),
    status: z.enum(VACCINATION_STATUSES).optional(),
    notes: longText.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateVaccinationBody = z.infer<typeof updateVaccinationBodySchema>;

export const vaccinationParamSchema = z.object({
  organizationId: z.string().uuid(),
  animalId: z.string().uuid(),
  vaccinationId: z.string().uuid(),
});

export const listVaccinationsQuerySchema = paginationQuerySchema.extend({
  dueFrom: anyDate.optional(),
});
export type ListVaccinationsQuery = z.infer<typeof listVaccinationsQuerySchema>;

// --- medical history / timeline (Phase 8) ------------------------

export const listMedicalHistoryQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['MEDICAL_RECORD', 'VACCINATION']).optional(),
});
export type ListMedicalHistoryQuery = z.infer<typeof listMedicalHistoryQuerySchema>;

// --- owner-facing -------------------------------------------------

export const ownerAnimalParamSchema = z.object({ animalId: z.string().uuid() });
export const ownerVaccinationParamSchema = z.object({
  animalId: z.string().uuid(),
  vaccinationId: z.string().uuid(),
});

// --- medical attachments (legacy prescription image / files) ------------

export const medicalAttachmentUploadUrlBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
  size: z.number().int().positive(),
});
export type MedicalAttachmentUploadUrlBody = z.infer<typeof medicalAttachmentUploadUrlBodySchema>;

// --- clinic-wide vaccination list ---------------------------------------

export const listClinicVaccinationsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(['ALL', ...VACCINATION_STATUSES, 'OVERDUE', 'DUE_TODAY'])
    .optional()
    .default('ALL'),
});
export type ListClinicVaccinationsQuery = z.infer<typeof listClinicVaccinationsQuerySchema>;

// --- reminders (legacy pet_reminders) ----------------------------------

const reminderTitle = z.string().trim().min(1).max(200);

export const createReminderBodySchema = z.object({
  title: reminderTitle,
  description: longText.nullable().optional(),
  reminderDate: anyDate,
  reminderType: z.enum(REMINDER_TYPES).optional(),
});
export type CreateReminderBody = z.infer<typeof createReminderBodySchema>;

export const updateReminderBodySchema = z
  .object({
    title: reminderTitle.optional(),
    description: longText.nullable().optional(),
    reminderDate: anyDate.optional(),
    reminderType: z.enum(REMINDER_TYPES).optional(),
    isCompleted: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateReminderBody = z.infer<typeof updateReminderBodySchema>;

export const reminderParamSchema = z.object({
  organizationId: z.string().uuid(),
  animalId: z.string().uuid(),
  reminderId: z.string().uuid(),
});

export const listRemindersQuerySchema = paginationQuerySchema;

export const listClinicRemindersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ALL', 'PENDING', 'OVERDUE', 'COMPLETED', 'TODAY']).optional().default('ALL'),
});
export type ListClinicRemindersQuery = z.infer<typeof listClinicRemindersQuerySchema>;

// --- quick-review templates ---------------------------------------------

const templateFields = {
  name: z.string().trim().min(1).max(200),
  templateType: z.enum(QUICK_REVIEW_TEMPLATE_TYPES).optional(),
  defaultDiagnosis: longText.nullable().optional(),
  defaultTreatment: longText.nullable().optional(),
  defaultNotes: longText.nullable().optional(),
  intervalDays: z.number().int().positive().max(3650).nullable().optional(),
};
export const createQuickReviewTemplateBodySchema = z.object(templateFields);
export type CreateQuickReviewTemplateBody = z.infer<typeof createQuickReviewTemplateBodySchema>;
export const updateQuickReviewTemplateBodySchema = z
  .object({ ...templateFields, name: templateFields.name.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateQuickReviewTemplateBody = z.infer<typeof updateQuickReviewTemplateBodySchema>;
export const quickReviewTemplateParamSchema = z.object({
  organizationId: z.string().uuid(),
  templateId: z.string().uuid(),
});
