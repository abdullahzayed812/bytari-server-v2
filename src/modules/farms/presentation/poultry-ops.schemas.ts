import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  FARM_APPOINTMENT_CATEGORIES,
  FARM_APPOINTMENT_STATUSES,
  FARM_CATEGORIES,
  FARM_EXPENSE_CATEGORIES,
  POULTRY_ACTIVITY_LEVELS,
  POULTRY_APPETITE_LEVELS,
  POULTRY_CASE_SEXES,
  POULTRY_CASE_STATUSES,
  POULTRY_HEALTH_EVENT_KINDS,
  POULTRY_HEALTH_EVENT_STATUSES,
} from '../domain/poultry-ops.constants.js';

// --- shared pieces --------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const pastOrToday = isoDate.refine(
  (v) => new Date(v) <= new Date(),
  'Date cannot be in the future',
);
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(4000);
const qty = z.coerce.number().nonnegative().max(100_000_000);
const money = z.coerce.number().nonnegative().max(1_000_000_000);
const count = z.coerce.number().int().nonnegative().max(100_000_000);
const uuid = z.string().uuid();

export const organizationParamSchema = z.object({ organizationId: uuid });
export const flockScopeParamSchema = z.object({ organizationId: uuid, flockId: uuid });

// --- farm profile ------------------------------------------------

export const updateFarmProfileBodySchema = z
  .object({
    address: shortText.max(500).nullable().optional(),
    capacity: count.nullable().optional(),
    establishedOn: pastOrToday.nullable().optional(),
    farmCategory: z.enum(FARM_CATEGORIES).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateFarmProfileBody = z.infer<typeof updateFarmProfileBodySchema>;

const filename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (v) => !v.includes('/') && !v.includes('\\'),
    'filename must not contain path separators',
  );
const mimeType = z.string().trim().min(1).max(255);

export const imageUploadUrlBodySchema = z
  .object({ filename, mimeType, size: z.number().int().positive() })
  .strict();
export type ImageUploadUrlBody = z.infer<typeof imageUploadUrlBodySchema>;

export const registerImageBodySchema = z
  .object({ storageKey: z.string().trim().min(1).max(1024), mimeType })
  .strict();
export type RegisterImageBody = z.infer<typeof registerImageBodySchema>;

// --- daily records ---------------------------------------------

export const recordIdParamSchema = flockScopeParamSchema.extend({ recordId: uuid });

export const createDailyRecordBodySchema = z.object({
  recordDate: pastOrToday,
  feedKg: qty.optional(),
  waterLiters: qty.optional(),
  appetite: z.enum(POULTRY_APPETITE_LEVELS).nullable().optional(),
  activity: z.enum(POULTRY_ACTIVITY_LEVELS).nullable().optional(),
  mortalityCount: count.optional(),
  mortalityCause: shortText.nullable().optional(),
  treatment: shortText.nullable().optional(),
  expenseAmount: money.optional(),
  averageWeightGrams: qty.nullable().optional(),
  notes: longText.nullable().optional(),
});
export type CreateDailyRecordBody = z.infer<typeof createDailyRecordBodySchema>;

export const updateDailyRecordBodySchema = z
  .object({
    feedKg: qty.optional(),
    waterLiters: qty.optional(),
    appetite: z.enum(POULTRY_APPETITE_LEVELS).nullable().optional(),
    activity: z.enum(POULTRY_ACTIVITY_LEVELS).nullable().optional(),
    mortalityCount: count.optional(),
    mortalityCause: shortText.nullable().optional(),
    treatment: shortText.nullable().optional(),
    expenseAmount: money.optional(),
    averageWeightGrams: qty.nullable().optional(),
    notes: longText.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateDailyRecordBody = z.infer<typeof updateDailyRecordBodySchema>;

export const listDailyRecordsQuerySchema = paginationQuerySchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListDailyRecordsQuery = z.infer<typeof listDailyRecordsQuerySchema>;

export const weeklySummaryQuerySchema = z.object({ weekOf: isoDate.optional() });
export type WeeklySummaryQuery = z.infer<typeof weeklySummaryQuerySchema>;

// --- expenses ------------------------------------------------

export const expenseIdParamSchema = organizationParamSchema.extend({ expenseId: uuid });

export const createExpenseBodySchema = z.object({
  category: z.enum(FARM_EXPENSE_CATEGORIES),
  amount: money,
  description: longText.nullable().optional(),
  spentOn: pastOrToday,
  poultryFlockId: uuid.nullable().optional(),
});
export type CreateExpenseBody = z.infer<typeof createExpenseBodySchema>;

export const updateExpenseBodySchema = z
  .object({
    category: z.enum(FARM_EXPENSE_CATEGORIES).optional(),
    amount: money.optional(),
    description: longText.nullable().optional(),
    spentOn: pastOrToday.optional(),
    poultryFlockId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateExpenseBody = z.infer<typeof updateExpenseBodySchema>;

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  category: z.enum(FARM_EXPENSE_CATEGORIES).optional(),
  poultryFlockId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

// --- health events ------------------------------------------

export const healthEventIdParamSchema = flockScopeParamSchema.extend({ eventId: uuid });

export const createHealthEventBodySchema = z.object({
  kind: z.enum(POULTRY_HEALTH_EVENT_KINDS),
  name: shortText,
  medication: shortText.nullable().optional(),
  dose: shortText.nullable().optional(),
  eventDate: isoDate,
  casesCount: count.nullable().optional(),
  coverageCount: count.nullable().optional(),
  nextDueDate: isoDate.nullable().optional(),
  status: z.enum(POULTRY_HEALTH_EVENT_STATUSES).optional(),
  notes: longText.nullable().optional(),
});
export type CreateHealthEventBody = z.infer<typeof createHealthEventBodySchema>;

export const updateHealthEventBodySchema = z
  .object({
    kind: z.enum(POULTRY_HEALTH_EVENT_KINDS).optional(),
    name: shortText.optional(),
    medication: shortText.nullable().optional(),
    dose: shortText.nullable().optional(),
    eventDate: isoDate.optional(),
    casesCount: count.nullable().optional(),
    coverageCount: count.nullable().optional(),
    nextDueDate: isoDate.nullable().optional(),
    status: z.enum(POULTRY_HEALTH_EVENT_STATUSES).optional(),
    notes: longText.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateHealthEventBody = z.infer<typeof updateHealthEventBodySchema>;

export const listHealthEventsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(POULTRY_HEALTH_EVENT_KINDS).optional(),
  status: z.enum(POULTRY_HEALTH_EVENT_STATUSES).optional(),
});
export type ListHealthEventsQuery = z.infer<typeof listHealthEventsQuerySchema>;

// --- appointments -----------------------------------------

export const appointmentIdParamSchema = organizationParamSchema.extend({ appointmentId: uuid });

export const createAppointmentBodySchema = z.object({
  title: shortText,
  description: longText.nullable().optional(),
  category: z.enum(FARM_APPOINTMENT_CATEGORIES).optional(),
  scheduledFor: isoDate,
  poultryFlockId: uuid.nullable().optional(),
});
export type CreateAppointmentBody = z.infer<typeof createAppointmentBodySchema>;

export const updateAppointmentBodySchema = z
  .object({
    title: shortText.optional(),
    description: longText.nullable().optional(),
    category: z.enum(FARM_APPOINTMENT_CATEGORIES).optional(),
    scheduledFor: isoDate.optional(),
    status: z.enum(FARM_APPOINTMENT_STATUSES).optional(),
    poultryFlockId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateAppointmentBody = z.infer<typeof updateAppointmentBodySchema>;

export const listAppointmentsQuerySchema = paginationQuerySchema.extend({
  category: z.enum(FARM_APPOINTMENT_CATEGORIES).optional(),
  status: z.enum(FARM_APPOINTMENT_STATUSES).optional(),
  from: isoDate.optional(),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

// --- individual cases -------------------------------------

export const caseIdParamSchema = flockScopeParamSchema.extend({ caseId: uuid });

export const createCaseBodySchema = z.object({
  animalTag: shortText.nullable().optional(),
  sex: z.enum(POULTRY_CASE_SEXES).optional(),
  diagnosis: shortText.nullable().optional(),
  treatment: shortText.nullable().optional(),
  startedOn: pastOrToday,
  nextFollowupOn: isoDate.nullable().optional(),
});
export type CreateCaseBody = z.infer<typeof createCaseBodySchema>;

export const updateCaseBodySchema = z
  .object({
    animalTag: shortText.nullable().optional(),
    sex: z.enum(POULTRY_CASE_SEXES).optional(),
    diagnosis: shortText.nullable().optional(),
    treatment: shortText.nullable().optional(),
    status: z.enum(POULTRY_CASE_STATUSES).optional(),
    startedOn: pastOrToday.optional(),
    nextFollowupOn: isoDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateCaseBody = z.infer<typeof updateCaseBodySchema>;

export const listCasesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(POULTRY_CASE_STATUSES).optional(),
});
export type ListCasesQuery = z.infer<typeof listCasesQuerySchema>;
