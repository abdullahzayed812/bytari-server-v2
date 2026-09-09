import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  VET_SERVICE_ANIMAL_TYPES,
  VET_SERVICE_DESCRIPTION_MAX,
  VET_SERVICE_ENGAGEMENT_STATUSES,
  VET_SERVICE_LOCATION_MODES,
  VET_SERVICE_MAX_IMAGES,
  VET_SERVICE_MODERATION_STATUSES,
  VET_SERVICE_NOTES_MAX,
  VET_SERVICE_PRICE_TYPES,
  VET_SERVICE_REASON_MAX,
  VET_SERVICE_TITLE_MAX,
  VET_SERVICE_TYPES,
  VET_SERVICE_URGENCIES,
} from '../domain/vet-service.constants.js';

const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'invalid amount');
const imageKeys = z.array(z.string().min(1)).max(VET_SERVICE_MAX_IMAGES).optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoDateTime = z.string().datetime({ offset: true });

export const idParamSchema = z.object({ id: z.string().uuid() });

// --- images ------------------------------------------------------

export const imageUploadUrlBodySchema = z
  .object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    size: z.number().int().positive(),
  })
  .strict();
export type ImageUploadUrlBody = z.infer<typeof imageUploadUrlBodySchema>;

// --- listings --------------------------------------------------

export const createListingBodySchema = z
  .object({
    title: z.string().trim().min(3).max(VET_SERVICE_TITLE_MAX),
    description: z.string().trim().min(10).max(VET_SERVICE_DESCRIPTION_MAX),
    serviceType: z.enum(VET_SERVICE_TYPES),
    animalType: z.enum(VET_SERVICE_ANIMAL_TYPES),
    specialty: z.string().trim().max(120).nullish(),
    governorate: z.string().trim().min(1).max(80),
    district: z.string().trim().max(120).nullish(),
    priceAmount: money.nullish(),
    priceType: z.enum(VET_SERVICE_PRICE_TYPES).optional(),
    locationMode: z.enum(VET_SERVICE_LOCATION_MODES).optional(),
    availability: z.string().trim().max(200).nullish(),
    contactPhone: z.string().trim().max(40).nullish(),
    contactWhatsapp: z.string().trim().max(40).nullish(),
    executionDuration: z.string().trim().max(80).nullish(),
    arrivalTime: z.string().trim().max(80).nullish(),
    details: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
    imageKeys,
  })
  .strict();
export type CreateListingBody = z.infer<typeof createListingBodySchema>;

export const listingBrowseQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  serviceType: z.enum(VET_SERVICE_TYPES).optional(),
  animalType: z.enum(VET_SERVICE_ANIMAL_TYPES).optional(),
  governorate: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
});
export type ListingBrowseQuery = z.infer<typeof listingBrowseQuerySchema>;

// --- requests ------------------------------------------------

export const createRequestBodySchema = z
  .object({
    title: z.string().trim().min(3).max(VET_SERVICE_TITLE_MAX),
    description: z.string().trim().min(10).max(VET_SERVICE_DESCRIPTION_MAX),
    animalType: z.enum(VET_SERVICE_ANIMAL_TYPES),
    serviceType: z.enum(VET_SERVICE_TYPES),
    animalCount: z.number().int().positive().nullish(),
    animalAge: z.string().trim().max(80).nullish(),
    governorate: z.string().trim().min(1).max(80),
    district: z.string().trim().max(120).nullish(),
    detailedAddress: z.string().trim().max(300).nullish(),
    needsFieldVisit: z.boolean().optional(),
    preferredDate: isoDate.nullish(),
    budgetAmount: money.nullish(),
    urgency: z.enum(VET_SERVICE_URGENCIES).optional(),
    extraNotes: z.string().trim().max(VET_SERVICE_NOTES_MAX).nullish(),
    imageKeys,
  })
  .strict();
export type CreateRequestBody = z.infer<typeof createRequestBodySchema>;

export const requestBrowseQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  serviceType: z.enum(VET_SERVICE_TYPES).optional(),
  animalType: z.enum(VET_SERVICE_ANIMAL_TYPES).optional(),
  governorate: z.string().trim().max(80).optional(),
  urgency: z.enum(VET_SERVICE_URGENCIES).optional(),
  sort: z.enum(['recent', 'oldest']).optional(),
});
export type RequestBrowseQuery = z.infer<typeof requestBrowseQuerySchema>;

// --- offers (vet → request) --------------------------------

export const createOfferBodySchema = z
  .object({
    proposedAmount: money.nullish(),
    executionDate: isoDate.nullish(),
    expectedDuration: z.string().trim().max(80).nullish(),
    includesFieldVisit: z.boolean().nullish(),
    details: z.string().trim().max(VET_SERVICE_NOTES_MAX).nullish(),
    imageKeys,
  })
  .strict();
export type CreateOfferBody = z.infer<typeof createOfferBodySchema>;

// --- listing-requests (owner → listing) ------------------

export const createListingRequestBodySchema = z
  .object({
    animalType: z.enum(VET_SERVICE_ANIMAL_TYPES),
    animalCount: z.number().int().positive().nullish(),
    animalAge: z.string().trim().max(80).nullish(),
    governorate: z.string().trim().max(80).nullish(),
    district: z.string().trim().max(120).nullish(),
    needsFieldVisit: z.boolean().optional(),
    preferredDatetime: isoDateTime.nullish(),
    budgetAmount: money.nullish(),
    notes: z.string().trim().max(VET_SERVICE_NOTES_MAX).nullish(),
    previousVisit: z.boolean().nullish(),
    imageKeys,
  })
  .strict();
export type CreateListingRequestBody = z.infer<typeof createListingRequestBodySchema>;

// --- shared --------------------------------------------

export const mineQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VET_SERVICE_MODERATION_STATUSES).optional(),
});
export type MineQuery = z.infer<typeof mineQuerySchema>;

export const engagementListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VET_SERVICE_ENGAGEMENT_STATUSES).optional(),
});
export type EngagementListQuery = z.infer<typeof engagementListQuerySchema>;

export const moderationQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VET_SERVICE_MODERATION_STATUSES).optional(),
});
export type ModerationQuery = z.infer<typeof moderationQuerySchema>;

export const rejectBodySchema = z
  .object({ reason: z.string().trim().min(1).max(VET_SERVICE_REASON_MAX) })
  .strict();
export type RejectBody = z.infer<typeof rejectBodySchema>;
