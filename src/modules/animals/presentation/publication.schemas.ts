import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { ANIMAL_SPECIES } from '../domain/animal.constants.js';
import {
  HEALTH_STATUSES,
  PUBLICATION_INTERACTION_TYPES,
  PUBLICATION_KINDS,
  PUBLICATION_STATUSES,
  VACCINATION_STATUSES,
} from '../domain/publication.constants.js';

// --- owner: create a publication -------------------------------
//
// Field set genuinely differs per kind (reference designs) — a discriminated
// union on `kind` gives each its own required/optional set instead of one
// loose object where "required" only lives in prose.

const contactName = z.string().trim().min(2).max(120);
const contactPhone = z.string().trim().min(3).max(40);
const cityField = z.string().trim().min(1).max(120);
const noteField = z.string().trim().max(2000);
const extraNotesField = z.string().trim().max(2000);
/** `YYYY-MM-DD`, not in the future. */
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(),
    'Invalid or future date',
  );
/** `HH:MM` (24h). */
const timeField = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

const lostPublicationSchema = z
  .object({
    kind: z.literal('LOST'),
    note: noteField.optional(),
    contactName,
    contactPhone,
    lostDate: dateField,
    lostTime: timeField.optional(),
    lostGovernorate: z.string().trim().min(1).max(120),
    lostDistrict: z.string().trim().min(1).max(120),
    lostLocationDetail: z.string().trim().max(500).optional(),
    healthNotes: z.string().trim().max(1000).optional(),
  })
  .strict();

const adoptionPublicationSchema = z
  .object({
    kind: z.literal('ADOPTION'),
    note: noteField.min(1),
    extraNotes: extraNotesField.optional(),
    contactName,
    contactPhone,
    city: cityField,
    healthStatus: z.enum(HEALTH_STATUSES),
    vaccinationStatus: z.enum(VACCINATION_STATUSES),
    isSterilized: z.boolean(),
  })
  .strict();

const matingPublicationSchema = z
  .object({
    kind: z.literal('MATING'),
    note: noteField.optional(),
    extraNotes: extraNotesField.optional(),
    contactName,
    contactPhone,
    city: cityField,
    healthStatus: z.enum(HEALTH_STATUSES),
    vaccinationStatus: z.enum(VACCINATION_STATUSES),
  })
  .strict();

export const createPublicationBodySchema = z.discriminatedUnion('kind', [
  lostPublicationSchema,
  adoptionPublicationSchema,
  matingPublicationSchema,
]);
export type CreatePublicationBody = z.infer<typeof createPublicationBodySchema>;

// --- params ---------------------------------------------------

export const animalPublicationParamSchema = z.object({
  animalId: z.string().uuid(),
  publicationId: z.string().uuid(),
});

export const publicationIdParamSchema = z.object({
  publicationId: z.string().uuid(),
});

// --- queries ------------------------------------------------

export const listAnimalPublicationsQuerySchema = paginationQuerySchema;

export const publicPublicationsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(PUBLICATION_KINDS).optional(),
  species: z.enum(ANIMAL_SPECIES).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type PublicPublicationsQuery = z.infer<typeof publicPublicationsQuerySchema>;

export const moderationPublicationsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(PUBLICATION_KINDS).optional(),
  status: z.enum(PUBLICATION_STATUSES).optional(),
});
export type ModerationPublicationsQuery = z.infer<typeof moderationPublicationsQuerySchema>;

/** "My listings" — the caller's own publications of every status. */
export const listMinePublicationsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(PUBLICATION_KINDS).optional(),
  status: z.enum(PUBLICATION_STATUSES).optional(),
});
export type ListMinePublicationsQuery = z.infer<typeof listMinePublicationsQuerySchema>;

// --- moderation: reject -----------------------------------

export const rejectPublicationBodySchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type RejectPublicationBody = z.infer<typeof rejectPublicationBodySchema>;

// --- interactions: "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" -----

export const createInteractionBodySchema = z
  .object({
    type: z.enum(PUBLICATION_INTERACTION_TYPES),
    message: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateInteractionBody = z.infer<typeof createInteractionBodySchema>;
