import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { MESSAGE_BODY_MAX, THREAD_STATUSES } from '../domain/thread.constants.js';

export const threadIdParamSchema = z.object({ threadId: z.string().uuid() });

/**
 * `createdBy` / `senderUserId` / `senderType` / responder identity are NEVER
 * accepted — `.strict()` rejects any unknown key. The creator is `req.auth`.
 */
export const createConsultationBodySchema = z
  .object({
    body: z.string().trim().min(1).max(MESSAGE_BODY_MAX),
    animalId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const createInquiryBodySchema = z
  .object({ body: z.string().trim().min(1).max(MESSAGE_BODY_MAX) })
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
