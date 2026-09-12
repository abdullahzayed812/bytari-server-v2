import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  VET_JOB_APPLICATION_STATUSES,
  VET_JOB_DESCRIPTION_MAX,
  VET_JOB_EMPLOYMENT_TYPES,
  VET_JOB_LIST_ITEM_MAX,
  VET_JOB_MAX_LIST_ITEMS,
  VET_JOB_MODERATION_STATUSES,
  VET_JOB_REASON_MAX,
  VET_JOB_TEXT_MAX,
  VET_JOB_TITLE_MAX,
} from '../domain/vet-job.constants.js';

const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'invalid amount');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const listItems = z.array(z.string().trim().min(1).max(VET_JOB_LIST_ITEM_MAX)).max(VET_JOB_MAX_LIST_ITEMS);
const phone = z.string().trim().min(5).max(30);

export const idParamSchema = z.object({ id: z.string().uuid() });

// --- attachments -------------------------------------------------

export const attachmentUploadUrlBodySchema = z
  .object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    size: z.number().int().positive(),
  })
  .strict();
export type AttachmentUploadUrlBody = z.infer<typeof attachmentUploadUrlBodySchema>;

// --- job offers --------------------------------------------------

export const createOfferBodySchema = z
  .object({
    organizationId: z.string().uuid().nullish(),
    organizationName: z.string().trim().min(1).max(VET_JOB_TITLE_MAX),
    title: z.string().trim().min(3).max(VET_JOB_TITLE_MAX),
    employmentType: z.enum(VET_JOB_EMPLOYMENT_TYPES),
    governorate: z.string().trim().min(1).max(80),
    district: z.string().trim().max(120).nullish(),
    salaryAmount: money.nullish(),
    salaryNegotiable: z.boolean().optional(),
    experienceYearsRequired: z.number().int().min(0).max(60).nullish(),
    qualifications: z.string().trim().max(VET_JOB_TEXT_MAX).nullish(),
    description: z.string().trim().min(10).max(VET_JOB_DESCRIPTION_MAX),
    responsibilities: listItems.optional(),
    requirements: listItems.optional(),
    benefits: listItems.optional(),
    contactPhone: phone,
    contactEmail: z.string().trim().email().nullish(),
    applicationDeadline: isoDate.nullish(),
  })
  .strict();
export type CreateOfferBody = z.infer<typeof createOfferBodySchema>;

export const updateOfferBodySchema = createOfferBodySchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one field is required' },
);
export type UpdateOfferBody = z.infer<typeof updateOfferBodySchema>;

export const offerBrowseQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  employmentType: z.enum(VET_JOB_EMPLOYMENT_TYPES).optional(),
  governorate: z.string().trim().max(80).optional(),
});
export type OfferBrowseQuery = z.infer<typeof offerBrowseQuerySchema>;

// --- job-seeker profiles ------------------------------------------

export const createSeekerProfileBodySchema = z
  .object({
    specialty: z.string().trim().min(1).max(120),
    headline: z.string().trim().max(VET_JOB_TEXT_MAX).nullish(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    governorate: z.string().trim().min(1).max(80),
    district: z.string().trim().max(120).nullish(),
    qualifications: z.string().trim().max(VET_JOB_TEXT_MAX).nullish(),
    skills: listItems.optional(),
    preferredEmploymentTypes: z.array(z.enum(VET_JOB_EMPLOYMENT_TYPES)).max(5).optional(),
    phone,
    email: z.string().trim().email().nullish(),
    cvStorageKey: z.string().trim().min(1).max(1024).nullish(),
    photoStorageKey: z.string().trim().min(1).max(1024).nullish(),
  })
  .strict();
export type CreateSeekerProfileBody = z.infer<typeof createSeekerProfileBodySchema>;

export const updateSeekerProfileBodySchema = createSeekerProfileBodySchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one field is required' },
);
export type UpdateSeekerProfileBody = z.infer<typeof updateSeekerProfileBodySchema>;

export const seekerBrowseQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  specialty: z.string().trim().max(120).optional(),
  governorate: z.string().trim().max(80).optional(),
});
export type SeekerBrowseQuery = z.infer<typeof seekerBrowseQuerySchema>;

// --- applications --------------------------------------------------

export const createApplicationBodySchema = z
  .object({
    fullName: z.string().trim().min(2).max(VET_JOB_TITLE_MAX),
    phone,
    email: z.string().trim().email().nullish(),
    specialty: z.string().trim().max(120).nullish(),
    experienceYears: z.number().int().min(0).max(60).nullish(),
    qualifications: z.string().trim().max(VET_JOB_TEXT_MAX).nullish(),
    coverNote: z.string().trim().max(VET_JOB_TEXT_MAX).nullish(),
    cvStorageKey: z.string().trim().min(1).max(1024).nullish(),
    photoStorageKey: z.string().trim().min(1).max(1024).nullish(),
  })
  .strict();
export type CreateApplicationBody = z.infer<typeof createApplicationBodySchema>;

export const applicationListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VET_JOB_APPLICATION_STATUSES).optional(),
});
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;

// --- shared --------------------------------------------------

export const mineQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VET_JOB_MODERATION_STATUSES).optional(),
});
export type MineQuery = z.infer<typeof mineQuerySchema>;

export const moderationQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VET_JOB_MODERATION_STATUSES).optional(),
});
export type ModerationQuery = z.infer<typeof moderationQuerySchema>;

export const rejectBodySchema = z
  .object({ reason: z.string().trim().min(1).max(VET_JOB_REASON_MAX) })
  .strict();
export type RejectBody = z.infer<typeof rejectBodySchema>;
