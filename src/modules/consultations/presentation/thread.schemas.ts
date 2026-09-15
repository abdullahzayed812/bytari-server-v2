import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  MAX_MESSAGE_IMAGE_BYTES,
  MAX_MESSAGE_IMAGES,
  MESSAGE_BODY_MAX,
  THREAD_STATUSES,
} from '../domain/thread.constants.js';

export const threadIdParamSchema = z.object({ threadId: z.string().uuid() });

const imageKeys = z.array(z.string().trim().min(1).max(1024)).max(MAX_MESSAGE_IMAGES).optional();

/**
 * `createdBy` / `senderUserId` / `senderType` / responder identity are NEVER
 * accepted — `.strict()` rejects any unknown key. The creator is `req.auth`.
 * `imageKeys` are storage keys from a prior `/attachments/upload-url` — the
 * server validates each one against the actual uploaded object.
 */
export const createConsultationBodySchema = z
  .object({
    body: z.string().trim().min(1).max(MESSAGE_BODY_MAX),
    animalId: z.string().uuid().nullable().optional(),
    imageKeys,
  })
  .strict();

export const createInquiryBodySchema = z
  .object({ body: z.string().trim().min(1).max(MESSAGE_BODY_MAX), imageKeys })
  .strict();

/** "تواصل معنا" — a support message. Body only; no animal, no recipient. */
export const createSupportBodySchema = z
  .object({ body: z.string().trim().min(1).max(MESSAGE_BODY_MAX) })
  .strict();

export const sendThreadMessageBodySchema = z
  .object({ body: z.string().trim().min(1).max(MESSAGE_BODY_MAX) })
  .strict();

export const listThreadsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(THREAD_STATUSES).optional(),
});

export const listAdminThreadsQuerySchema = listThreadsQuerySchema.extend({
  createdBy: z.string().uuid().optional(),
});

export const listMessagesQuerySchema = paginationQuerySchema;

const hasControlChar = (v: string): boolean => {
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const attachmentFilename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((v) => !v.includes('/') && !v.includes('\\') && !hasControlChar(v), {
    message: 'filename must not contain path separators or control characters',
  });
const attachmentMimeType = z.string().trim().min(1).max(255);

/** `POST /consultations/attachments/upload-url` / `POST /inquiries/attachments/upload-url`. */
export const attachmentUploadUrlBodySchema = z
  .object({
    filename: attachmentFilename,
    mimeType: attachmentMimeType,
    size: z.number().int().positive().max(MAX_MESSAGE_IMAGE_BYTES),
  })
  .strict();

export const updateAiSettingsBodySchema = z
  .object({
    consultationAiEnabled: z.boolean().optional(),
    inquiryAiEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.consultationAiEnabled !== undefined || v.inquiryAiEnabled !== undefined, {
    message: 'Provide consultationAiEnabled and/or inquiryAiEnabled',
  });

export type CreateConsultationBody = z.infer<typeof createConsultationBodySchema>;
export type CreateInquiryBody = z.infer<typeof createInquiryBodySchema>;
export type CreateSupportBody = z.infer<typeof createSupportBodySchema>;
export type SendThreadMessageBody = z.infer<typeof sendThreadMessageBodySchema>;
export type ListThreadsQuery = z.infer<typeof listThreadsQuerySchema>;
export type ListAdminThreadsQuery = z.infer<typeof listAdminThreadsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type UpdateAiSettingsBody = z.infer<typeof updateAiSettingsBodySchema>;
export type AttachmentUploadUrlBody = z.infer<typeof attachmentUploadUrlBodySchema>;
