import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  SYNDICATE_ANNOUNCEMENT_TYPES,
  SYNDICATE_BODY_MAX,
  SYNDICATE_DESCRIPTION_MAX,
  SYNDICATE_MAX_ATTACHMENTS,
  SYNDICATE_MESSAGE_MAX,
  SYNDICATE_NAME_MAX,
  SYNDICATE_REQUEST_TYPES,
  SYNDICATE_RESPONSE_MAX,
  SYNDICATE_SUBMISSION_KINDS,
  SYNDICATE_SUBMISSION_STATUSES,
  SYNDICATE_TEXT_MAX,
  SYNDICATE_TITLE_MAX,
} from '../domain/syndicate.constants.js';

export const idParamSchema = z.object({ id: z.string().uuid() });
export const organizationIdParamSchema = z.object({ organizationId: z.string().uuid() });
export const organizationAndIdParamSchema = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

// --- image / attachment upload -----------------------------------------

export const uploadUrlBodySchema = z
  .object({
    kind: z.enum(['LOGO', 'ANNOUNCEMENT_IMAGE', 'SUBMISSION_ATTACHMENT']),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    size: z.number().int().positive(),
  })
  .strict();
export type UploadUrlBody = z.infer<typeof uploadUrlBodySchema>;

// --- syndicate profile ------------------------------------------------

export const createSyndicateBodySchema = z
  .object({
    parentOrganizationId: z.string().uuid().nullish(),
    name: z.string().trim().min(2).max(SYNDICATE_NAME_MAX),
    description: z.string().trim().max(SYNDICATE_DESCRIPTION_MAX).nullish(),
    governorate: z.string().trim().max(80).nullish(),
    address: z.string().trim().max(SYNDICATE_TEXT_MAX).nullish(),
    phone: z.string().trim().max(40).nullish(),
    email: z.string().trim().email().max(255).nullish(),
    website: z.string().trim().url().max(300).nullish(),
    headOfficerName: z.string().trim().max(160).nullish(),
    headOfficerTitle: z.string().trim().max(SYNDICATE_TEXT_MAX).nullish(),
    termStartYear: z.number().int().min(1900).max(3000).nullish(),
    termEndYear: z.number().int().min(1900).max(3000).nullish(),
  })
  .strict();
export type CreateSyndicateBody = z.infer<typeof createSyndicateBodySchema>;

export const updateSyndicateProfileBodySchema = z
  .object({
    name: z.string().trim().min(2).max(SYNDICATE_NAME_MAX).optional(),
    description: z.string().trim().max(SYNDICATE_DESCRIPTION_MAX).nullable().optional(),
    governorate: z.string().trim().max(80).nullable().optional(),
    address: z.string().trim().max(SYNDICATE_TEXT_MAX).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().email().max(255).nullable().optional(),
    website: z.string().trim().url().max(300).nullable().optional(),
    logoStorageKey: z.string().trim().min(1).max(1024).nullable().optional(),
    headOfficerName: z.string().trim().max(160).nullable().optional(),
    headOfficerTitle: z.string().trim().max(SYNDICATE_TEXT_MAX).nullable().optional(),
    termStartYear: z.number().int().min(1900).max(3000).nullable().optional(),
    termEndYear: z.number().int().min(1900).max(3000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateSyndicateProfileBody = z.infer<typeof updateSyndicateProfileBodySchema>;

export const syndicateBrowseQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(160).optional(),
});
export type SyndicateBrowseQuery = z.infer<typeof syndicateBrowseQuerySchema>;

// --- announcements --------------------------------------------------

export const createAnnouncementBodySchema = z
  .object({
    type: z.enum(SYNDICATE_ANNOUNCEMENT_TYPES),
    title: z.string().trim().min(3).max(SYNDICATE_TITLE_MAX),
    body: z.string().trim().min(3).max(SYNDICATE_BODY_MAX),
    imageStorageKey: z.string().trim().min(1).max(1024).nullish(),
  })
  .strict();
export type CreateAnnouncementBody = z.infer<typeof createAnnouncementBodySchema>;

export const updateAnnouncementBodySchema = createAnnouncementBodySchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateAnnouncementBody = z.infer<typeof updateAnnouncementBodySchema>;

export const announcementListQuerySchema = paginationQuerySchema;
export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>;

// --- submissions (requests + inquiries) --------------------------------

export const createSubmissionBodySchema = z
  .object({
    kind: z.enum(SYNDICATE_SUBMISSION_KINDS),
    requestType: z.enum(SYNDICATE_REQUEST_TYPES).nullish(),
    message: z.string().trim().min(1).max(SYNDICATE_MESSAGE_MAX),
    attachmentStorageKeys: z.array(z.string().trim().min(1).max(1024)).max(SYNDICATE_MAX_ATTACHMENTS).optional(),
  })
  .strict()
  .refine((v) => v.kind !== 'REQUEST' || v.requestType, {
    message: 'requestType is required when kind is REQUEST',
    path: ['requestType'],
  });
export type CreateSubmissionBody = z.infer<typeof createSubmissionBodySchema>;

export const submissionListQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(SYNDICATE_SUBMISSION_KINDS).optional(),
  status: z.enum(SYNDICATE_SUBMISSION_STATUSES).optional(),
});
export type SubmissionListQuery = z.infer<typeof submissionListQuerySchema>;

export const mySubmissionListQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(SYNDICATE_SUBMISSION_KINDS).optional(),
});
export type MySubmissionListQuery = z.infer<typeof mySubmissionListQuerySchema>;

export const respondSubmissionBodySchema = z
  .object({ responseText: z.string().trim().min(1).max(SYNDICATE_RESPONSE_MAX) })
  .strict();
export type RespondSubmissionBody = z.infer<typeof respondSubmissionBodySchema>;
