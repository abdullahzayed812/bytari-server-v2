import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  LIVESTOCK_ACTIVITY_LEVELS,
  LIVESTOCK_APPETITE_LEVELS,
  LIVESTOCK_CASE_SEXES,
  LIVESTOCK_CASE_STATUSES,
  LIVESTOCK_FEED_TYPES,
  LIVESTOCK_HEALTH_EVENT_KINDS,
  LIVESTOCK_HEALTH_EVENT_STATUSES,
} from '../domain/livestock-ops.constants.js';
import { batchParamSchema } from './cattle-batch.schemas.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const pastOrToday = isoDate.refine((v) => new Date(v) <= new Date(), 'Date cannot be in the future');
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(4000);
const qty = z.coerce.number().nonnegative().max(100_000_000);
const money = z.coerce.number().nonnegative().max(1_000_000_000);
const count = z.coerce.number().int().nonnegative().max(100_000_000);
const uuid = z.string().uuid();

export const filename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((v) => !v.includes('/') && !v.includes('\\'), 'filename must not contain path separators');
export const mimeType = z.string().trim().min(1).max(255);

export const imageUploadUrlBodySchema = z
  .object({ filename, mimeType, size: z.number().int().positive() })
  .strict();
export type ImageUploadUrlBody = z.infer<typeof imageUploadUrlBodySchema>;

export const registerImageBodySchema = z
  .object({ storageKey: z.string().trim().min(1).max(1024), mimeType })
  .strict();
export type RegisterImageBody = z.infer<typeof registerImageBodySchema>;

// --- daily records ---------------------------------------------

export const recordIdParamSchema = batchParamSchema.extend({ recordId: uuid });

export const createDailyRecordBodySchema = z.object({
  recordDate: pastOrToday,
  feedKg: qty.optional(),
  waterLiters: qty.optional(),
  appetite: z.enum(LIVESTOCK_APPETITE_LEVELS).nullable().optional(),
  activity: z.enum(LIVESTOCK_ACTIVITY_LEVELS).nullable().optional(),
  mortalityCount: count.optional(),
  mortalityCause: shortText.nullable().optional(),
  sickCasesCount: count.optional(),
  feedType: z.enum(LIVESTOCK_FEED_TYPES).nullable().optional(),
  treatment: shortText.nullable().optional(),
  expenseAmount: money.optional(),
  averageWeightKg: qty.nullable().optional(),
  notes: longText.nullable().optional(),
});
export type CreateDailyRecordBody = z.infer<typeof createDailyRecordBodySchema>;

export const updateDailyRecordBodySchema = z
  .object({
    feedKg: qty.optional(),
    waterLiters: qty.optional(),
    appetite: z.enum(LIVESTOCK_APPETITE_LEVELS).nullable().optional(),
    activity: z.enum(LIVESTOCK_ACTIVITY_LEVELS).nullable().optional(),
    mortalityCount: count.optional(),
    mortalityCause: shortText.nullable().optional(),
    sickCasesCount: count.optional(),
    feedType: z.enum(LIVESTOCK_FEED_TYPES).nullable().optional(),
    treatment: shortText.nullable().optional(),
    expenseAmount: money.optional(),
    averageWeightKg: qty.nullable().optional(),
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

// --- health events ------------------------------------------

export const healthEventIdParamSchema = batchParamSchema.extend({ eventId: uuid });

export const createHealthEventBodySchema = z.object({
  kind: z.enum(LIVESTOCK_HEALTH_EVENT_KINDS),
  name: shortText,
  medication: shortText.nullable().optional(),
  dose: shortText.nullable().optional(),
  eventDate: isoDate,
  casesCount: count.nullable().optional(),
  coverageCount: count.nullable().optional(),
  nextDueDate: isoDate.nullable().optional(),
  status: z.enum(LIVESTOCK_HEALTH_EVENT_STATUSES).optional(),
  notes: longText.nullable().optional(),
});
export type CreateHealthEventBody = z.infer<typeof createHealthEventBodySchema>;

export const updateHealthEventBodySchema = z
  .object({
    kind: z.enum(LIVESTOCK_HEALTH_EVENT_KINDS).optional(),
    name: shortText.optional(),
    medication: shortText.nullable().optional(),
    dose: shortText.nullable().optional(),
    eventDate: isoDate.optional(),
    casesCount: count.nullable().optional(),
    coverageCount: count.nullable().optional(),
    nextDueDate: isoDate.nullable().optional(),
    status: z.enum(LIVESTOCK_HEALTH_EVENT_STATUSES).optional(),
    notes: longText.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateHealthEventBody = z.infer<typeof updateHealthEventBodySchema>;

export const listHealthEventsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(LIVESTOCK_HEALTH_EVENT_KINDS).optional(),
  status: z.enum(LIVESTOCK_HEALTH_EVENT_STATUSES).optional(),
});
export type ListHealthEventsQuery = z.infer<typeof listHealthEventsQuerySchema>;

// --- individual cases -------------------------------------

export const caseIdParamSchema = batchParamSchema.extend({ caseId: uuid });

export const createCaseBodySchema = z.object({
  animalTag: shortText.nullable().optional(),
  sex: z.enum(LIVESTOCK_CASE_SEXES).optional(),
  diagnosis: shortText.nullable().optional(),
  treatment: shortText.nullable().optional(),
  startedOn: pastOrToday,
  nextFollowupOn: isoDate.nullable().optional(),
});
export type CreateCaseBody = z.infer<typeof createCaseBodySchema>;

export const updateCaseBodySchema = z
  .object({
    animalTag: shortText.nullable().optional(),
    sex: z.enum(LIVESTOCK_CASE_SEXES).optional(),
    diagnosis: shortText.nullable().optional(),
    treatment: shortText.nullable().optional(),
    status: z.enum(LIVESTOCK_CASE_STATUSES).optional(),
    startedOn: pastOrToday.optional(),
    nextFollowupOn: isoDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateCaseBody = z.infer<typeof updateCaseBodySchema>;

export const listCasesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(LIVESTOCK_CASE_STATUSES).optional(),
});
export type ListCasesQuery = z.infer<typeof listCasesQuerySchema>;
