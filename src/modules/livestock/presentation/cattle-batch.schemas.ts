import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { CATTLE_BATCH_STATUSES, CATTLE_PRODUCTION_TYPES } from '../domain/cattle-batch.constants.js';

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

// --- "Add Cattle Farm" creation form -------------------------------

export const createCattleFarmBodySchema = z.object({
  name: shortText(160),
  location: shortText(200),
  governorate: shortText(120),
  cattleProductionType: z.enum(CATTLE_PRODUCTION_TYPES),
  description: z.string().trim().min(1).max(2000).nullable().optional(),
  address: shortText(500).nullable().optional(),
  capacity: capacityCount.nullable().optional(),
  currentCattleCount: capacityCount.nullable().optional(),
  contactName: shortText(160).nullable().optional(),
  contactPhone: z.string().trim().min(3).max(40).nullable().optional(),
  contactEmail: z.string().trim().max(255).email().nullable().optional(),
});
export type CreateCattleFarmBody = z.infer<typeof createCattleFarmBodySchema>;

// --- cattle batches --------------------------------------------

export const createCattleBatchBodySchema = z.object({
  name: nameSchema,
  breed: shortText(120).nullable().optional(),
  headCount: headCountSchema,
  calfCount: headCountSchema.nullable().optional(),
  bullCount: headCountSchema.nullable().optional(),
  cowCount: headCountSchema.nullable().optional(),
  arrivalDate: pastOrTodayDate,
  notes: notesSchema.nullable().optional(),
  initialHeadCount: headCountSchema.nullable().optional(),
  averageWeightKg: weightKgSchema.nullable().optional(),
  targetPricePerKg: priceSchema.nullable().optional(),
  expectedSaleDate: futureOrTodayDate.nullable().optional(),
});
export type CreateCattleBatchBody = z.infer<typeof createCattleBatchBodySchema>;

export const updateCattleBatchBodySchema = z
  .object({
    name: nameSchema.optional(),
    breed: shortText(120).nullable().optional(),
    headCount: headCountSchema.optional(),
    calfCount: headCountSchema.nullable().optional(),
    bullCount: headCountSchema.nullable().optional(),
    cowCount: headCountSchema.nullable().optional(),
    arrivalDate: pastOrTodayDate.optional(),
    status: z.enum(CATTLE_BATCH_STATUSES).optional(),
    notes: notesSchema.nullable().optional(),
    initialHeadCount: headCountSchema.nullable().optional(),
    averageWeightKg: weightKgSchema.nullable().optional(),
    targetPricePerKg: priceSchema.nullable().optional(),
    expectedSaleDate: futureOrTodayDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateCattleBatchBody = z.infer<typeof updateCattleBatchBodySchema>;

export const batchParamSchema = z.object({
  organizationId: z.string().uuid(),
  batchId: z.string().uuid(),
});

export const organizationParamSchema = z.object({ organizationId: z.string().uuid() });

export const listCattleBatchesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CATTLE_BATCH_STATUSES).optional(),
});
export type ListCattleBatchesQuery = z.infer<typeof listCattleBatchesQuerySchema>;
