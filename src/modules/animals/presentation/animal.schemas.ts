import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  ANIMAL_AGE_ESTIMATES,
  ANIMAL_SEXES,
  ANIMAL_SPECIES,
  ANIMAL_STATUSES,
} from '../domain/animal.constants.js';

const nameSchema = z.string().trim().min(1).max(120);
const breedSchema = z.string().trim().min(1).max(120);
const notesSchema = z.string().trim().max(2000);
const colorSchema = z.string().trim().min(1).max(80);
const distinguishingFeaturesSchema = z.string().trim().min(1).max(500);
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
  color: colorSchema.optional(),
  distinguishingFeatures: distinguishingFeaturesSchema.optional(),
  ageEstimate: z.enum(ANIMAL_AGE_ESTIMATES).optional(),
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
    color: colorSchema.nullable().optional(),
    distinguishingFeatures: distinguishingFeaturesSchema.nullable().optional(),
    ageEstimate: z.enum(ANIMAL_AGE_ESTIMATES).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateAnimalBody = z.infer<typeof updateAnimalBodySchema>;

// --- gallery (presigned direct-to-storage upload) -------------------

export const animalGalleryUploadUrlBodySchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((v) => !v.includes('/') && !v.includes('\\'), {
        message: 'filename must not contain path separators',
      }),
    mimeType: z.string().trim().min(1).max(255),
    size: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024),
  })
  .strict();
export type AnimalGalleryUploadUrlBody = z.infer<typeof animalGalleryUploadUrlBodySchema>;

export const finalizeAnimalGalleryBodySchema = z
  .object({
    storageKey: z.string().trim().min(1).max(1024),
    mimeType: z.string().trim().min(1).max(255),
  })
  .strict();
export type FinalizeAnimalGalleryBody = z.infer<typeof finalizeAnimalGalleryBodySchema>;

export const removeAnimalGalleryImageQuerySchema = z.object({
  storageKey: z.string().trim().min(1).max(1024),
});
export type RemoveAnimalGalleryImageQuery = z.infer<typeof removeAnimalGalleryImageQuerySchema>;

export const listAnimalsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ANIMAL_STATUSES).optional(),
  species: z.enum(ANIMAL_SPECIES).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListAnimalsQuery = z.infer<typeof listAnimalsQuerySchema>;
