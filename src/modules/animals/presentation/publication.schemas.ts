import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { PUBLICATION_KINDS, PUBLICATION_STATUSES } from '../domain/publication.constants.js';

// --- owner: create a publication -------------------------------

export const createPublicationBodySchema = z.object({
  kind: z.enum(PUBLICATION_KINDS),
  note: z.string().trim().min(1).max(2000).nullable().optional(),
});
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
});
export type PublicPublicationsQuery = z.infer<typeof publicPublicationsQuerySchema>;

export const moderationPublicationsQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(PUBLICATION_KINDS).optional(),
  status: z.enum(PUBLICATION_STATUSES).optional(),
});
export type ModerationPublicationsQuery = z.infer<typeof moderationPublicationsQuerySchema>;

// --- moderation: reject -----------------------------------

export const rejectPublicationBodySchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type RejectPublicationBody = z.infer<typeof rejectPublicationBodySchema>;
