import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';

/** `YYYY-MM-DD`, a real calendar date, not in the future. */
const pastOrTodayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(),
    'Invalid or future date',
  );

/** `YYYY-MM-DD`, a real calendar date (may be in the future — e.g. next-due). */
const anyDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

const shortText = z.string().trim().min(1).max(2000);
const longText = z.string().trim().min(1).max(8000);

// --- clinic ↔ animal access ------------------------------------------

export const grantAnimalAccessBodySchema = z.object({
  animalId: z.string().uuid(),
});
export type GrantAnimalAccessBody = z.infer<typeof grantAnimalAccessBodySchema>;

/** `{ organizationId, animalId }` — clinic-scoped animal sub-resources. */
export const clinicAnimalParamSchema = z.object({
  organizationId: z.string().uuid(),
  animalId: z.string().uuid(),
});

export const listClinicAnimalsQuerySchema = paginationQuerySchema;

// --- medical records ------------------------------------------------

const medicalRecordFields = {
  visitDate: pastOrTodayDate.optional(),
  reason: shortText.nullable().optional(),
  diagnosis: longText.nullable().optional(),
  treatment: longText.nullable().optional(),
  notes: longText.nullable().optional(),
};

export const createMedicalRecordBodySchema = z
  .object(medicalRecordFields)
  .refine(
    (v) => v.reason != null || v.diagnosis != null || v.treatment != null || v.notes != null,
    { message: 'Provide at least one of reason, diagnosis, treatment or notes' },
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
  notes: longText.nullable().optional(),
});
export type CreateVaccinationBody = z.infer<typeof createVaccinationBodySchema>;

export const updateVaccinationBodySchema = z
  .object({
    vaccineName: z.string().trim().min(1).max(200).optional(),
    administeredOn: pastOrTodayDate.optional(),
    nextDueOn: anyDate.nullable().optional(),
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
export const ownerMedicalRecordParamSchema = z.object({
  animalId: z.string().uuid(),
  recordId: z.string().uuid(),
});
export const ownerVaccinationParamSchema = z.object({
  animalId: z.string().uuid(),
  vaccinationId: z.string().uuid(),
});
