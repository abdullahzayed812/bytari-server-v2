import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  POULTRY_BIRD_TYPES,
  POULTRY_FLOCK_STATUSES,
  POULTRY_PRODUCTION_TYPES,
} from '../domain/poultry-ops.constants.js';

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

// --- "Add Poultry Farm" creation form -------------------------------

const shortText = (max: number): z.ZodString => z.string().trim().min(1).max(max);
const capacityCount = z.coerce.number().int().min(0).max(100_000_000);

/**
 * `POST /organizations/farms` — the domain-specific farm creation form. The
 * user never chooses an organization type; the backend creates a FARM
 * organization + `farm_details` + the OWNER membership in one transaction and
 * starts it as `PENDING` (admin review before activation). Required per the
 * reference design: name, location, governorate, production type.
 */
export const createPoultryFarmBodySchema = z.object({
  name: shortText(160),
  location: shortText(200),
  governorate: shortText(120),
  poultryProductionType: z.enum(POULTRY_PRODUCTION_TYPES),
  description: z.string().trim().min(1).max(2000).nullable().optional(),
  address: shortText(500).nullable().optional(),
  capacity: capacityCount.nullable().optional(),
  currentBirdCount: capacityCount.nullable().optional(),
  contactName: shortText(160).nullable().optional(),
  contactPhone: z.string().trim().min(3).max(40).nullable().optional(),
  contactEmail: z.string().trim().max(255).email().nullable().optional(),
});
export type CreatePoultryFarmBody = z.infer<typeof createPoultryFarmBodySchema>;

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
