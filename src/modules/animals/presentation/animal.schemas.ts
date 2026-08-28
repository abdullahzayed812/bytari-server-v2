import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { ANIMAL_SEXES, ANIMAL_SPECIES, ANIMAL_STATUSES } from '../domain/animal.constants.js';

const nameSchema = z.string().trim().min(1).max(120);
const breedSchema = z.string().trim().min(1).max(120);
const notesSchema = z.string().trim().max(2000);
/** `YYYY-MM-DD`, not in the future. */
const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(),
    'Invalid or future date',
  );

export const createAnimalBodySchema = z.object({
  name: nameSchema,
  species: z.enum(ANIMAL_SPECIES),
  breed: breedSchema.optional(),
  sex: z.enum(ANIMAL_SEXES).optional(),
  dateOfBirth: dateOfBirthSchema.optional(),
  notes: notesSchema.optional(),
});
export type CreateAnimalBody = z.infer<typeof createAnimalBodySchema>;

export const updateAnimalBodySchema = z
  .object({
    name: nameSchema.optional(),
    species: z.enum(ANIMAL_SPECIES).optional(),
    breed: breedSchema.nullable().optional(),
    sex: z.enum(ANIMAL_SEXES).optional(),
    dateOfBirth: dateOfBirthSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateAnimalBody = z.infer<typeof updateAnimalBodySchema>;

export const listAnimalsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ANIMAL_STATUSES).optional(),
  species: z.enum(ANIMAL_SPECIES).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListAnimalsQuery = z.infer<typeof listAnimalsQuerySchema>;

export const transferOwnershipBodySchema = z.object({
  toUserId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});
export type TransferOwnershipBody = z.infer<typeof transferOwnershipBodySchema>;
