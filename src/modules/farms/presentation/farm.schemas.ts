import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { POULTRY_BIRD_TYPES, POULTRY_FLOCK_STATUSES } from '../domain/farm.constants.js';

/** `YYYY-MM-DD`, a real calendar date, not in the future. */
const pastOrTodayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(),
    'Invalid or future date',
  );

const notesSchema = z.string().trim().min(1).max(4000);
const nameSchema = z.string().trim().min(1).max(120);
const birdCountSchema = z.coerce.number().int().min(0).max(100_000_000);
const weightGramsSchema = z.coerce.number().nonnegative().max(1_000_000);
const priceSchema = z.coerce.number().nonnegative().max(1_000_000_000);
const futureOrTodayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

// --- join flow ---------------------------------------------------

export const joinFarmBodySchema = z.object({
  joinCode: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .transform((s) => s.toUpperCase()),
});
export type JoinFarmBody = z.infer<typeof joinFarmBodySchema>;

// --- poultry flocks --------------------------------------------

export const createPoultryFlockBodySchema = z.object({
  name: nameSchema,
  birdType: z.enum(POULTRY_BIRD_TYPES),
  birdCount: birdCountSchema,
  arrivalDate: pastOrTodayDate,
  notes: notesSchema.nullable().optional(),
  initialBirdCount: birdCountSchema.nullable().optional(),
  averageWeightGrams: weightGramsSchema.nullable().optional(),
  targetPricePerKg: priceSchema.nullable().optional(),
  expectedSaleDate: futureOrTodayDate.nullable().optional(),
});
export type CreatePoultryFlockBody = z.infer<typeof createPoultryFlockBodySchema>;

export const updatePoultryFlockBodySchema = z
  .object({
    name: nameSchema.optional(),
    birdType: z.enum(POULTRY_BIRD_TYPES).optional(),
    birdCount: birdCountSchema.optional(),
    arrivalDate: pastOrTodayDate.optional(),
    status: z.enum(POULTRY_FLOCK_STATUSES).optional(),
    notes: notesSchema.nullable().optional(),
    initialBirdCount: birdCountSchema.nullable().optional(),
    averageWeightGrams: weightGramsSchema.nullable().optional(),
    targetPricePerKg: priceSchema.nullable().optional(),
    expectedSaleDate: futureOrTodayDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdatePoultryFlockBody = z.infer<typeof updatePoultryFlockBodySchema>;

export const flockParamSchema = z.object({
  organizationId: z.string().uuid(),
  flockId: z.string().uuid(),
});

export const organizationPoultryParamSchema = z.object({
  organizationId: z.string().uuid(),
});

export const listPoultryFlocksQuerySchema = paginationQuerySchema.extend({
  status: z.enum(POULTRY_FLOCK_STATUSES).optional(),
  birdType: z.enum(POULTRY_BIRD_TYPES).optional(),
});
export type ListPoultryFlocksQuery = z.infer<typeof listPoultryFlocksQuerySchema>;
