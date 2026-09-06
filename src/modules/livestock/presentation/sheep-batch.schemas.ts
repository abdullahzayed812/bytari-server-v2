import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { SHEEP_BATCH_STATUSES, SHEEP_PRODUCTION_TYPES } from '../domain/sheep-batch.constants.js';

const notesSchema = z.string().trim().min(1).max(4000);
const nameSchema = z.string().trim().min(1).max(120);
const headCountSchema = z.coerce.number().int().min(0).max(100_000_000);
const weightKgSchema = z.coerce.number().nonnegative().max(1_000_000);
const priceSchema = z.coerce.number().nonnegative().max(1_000_000_000);
const pastOrTodayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(), 'Invalid or future date');
const futureOrTodayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const shortText = (max: number): z.ZodString => z.string().trim().min(1).max(max);
const capacityCount = z.coerce.number().int().min(0).max(100_000_000);

// --- "Add Sheep Farm" creation form -------------------------------

export const createSheepFarmBodySchema = z.object({
  name: shortText(160),
  location: shortText(200),
  governorate: shortText(120),
  sheepProductionType: z.enum(SHEEP_PRODUCTION_TYPES),
  description: z.string().trim().min(1).max(2000).nullable().optional(),
  address: shortText(500).nullable().optional(),
  capacity: capacityCount.nullable().optional(),
  currentSheepCount: capacityCount.nullable().optional(),
  contactName: shortText(160).nullable().optional(),
  contactPhone: z.string().trim().min(3).max(40).nullable().optional(),
  contactEmail: z.string().trim().max(255).email().nullable().optional(),
});
export type CreateSheepFarmBody = z.infer<typeof createSheepFarmBodySchema>;

// --- sheep batches --------------------------------------------

export const createSheepBatchBodySchema = z.object({
  name: nameSchema,
  breed: shortText(120).nullable().optional(),
  headCount: headCountSchema,
  lambCount: headCountSchema.nullable().optional(),
  maleCount: headCountSchema.nullable().optional(),
  femaleCount: headCountSchema.nullable().optional(),
  arrivalDate: pastOrTodayDate,
  notes: notesSchema.nullable().optional(),
  initialHeadCount: headCountSchema.nullable().optional(),
  averageWeightKg: weightKgSchema.nullable().optional(),
  targetPricePerKg: priceSchema.nullable().optional(),
  expectedSaleDate: futureOrTodayDate.nullable().optional(),
});
export type CreateSheepBatchBody = z.infer<typeof createSheepBatchBodySchema>;

export const updateSheepBatchBodySchema = z
  .object({
    name: nameSchema.optional(),
    breed: shortText(120).nullable().optional(),
    headCount: headCountSchema.optional(),
    lambCount: headCountSchema.nullable().optional(),
    maleCount: headCountSchema.nullable().optional(),
    femaleCount: headCountSchema.nullable().optional(),
    arrivalDate: pastOrTodayDate.optional(),
    status: z.enum(SHEEP_BATCH_STATUSES).optional(),
    notes: notesSchema.nullable().optional(),
    initialHeadCount: headCountSchema.nullable().optional(),
    averageWeightKg: weightKgSchema.nullable().optional(),
    targetPricePerKg: priceSchema.nullable().optional(),
    expectedSaleDate: futureOrTodayDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateSheepBatchBody = z.infer<typeof updateSheepBatchBodySchema>;

export const batchParamSchema = z.object({
  organizationId: z.string().uuid(),
  batchId: z.string().uuid(),
});

export const organizationParamSchema = z.object({ organizationId: z.string().uuid() });

export const listSheepBatchesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(SHEEP_BATCH_STATUSES).optional(),
});
export type ListSheepBatchesQuery = z.infer<typeof listSheepBatchesQuerySchema>;
