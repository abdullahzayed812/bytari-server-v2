import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  CHAT_ATTACHMENT_FILENAME_MAX,
  CHAT_ATTACHMENT_KINDS,
  MESSAGE_BODY_MAX,
} from '../domain/chat.constants.js';

export const organizationIdParamSchema = z.object({ organizationId: z.string().uuid() });

export const conversationIdParamSchema = z.object({ conversationId: z.string().uuid() });

export const messageIdParamSchema = z.object({ messageId: z.string().uuid() });

/**
 * `targetUserId` is only meaningful when the *organization side* opens the
 * conversation (clinic member names the pet owner; farm owner names the member).
 * When a pet owner / farm member opens their own conversation it is omitted.
 * `organizationId` / `createdBy` are never read from the body — the org comes
 * from the route, the creator from `req.auth`.
 */
export const createConversationBodySchema = z
  .object({ targetUserId: z.string().uuid().optional() })
  .strict();

/**
 * Text and/or one attachment (uploaded first via
 * `POST /conversations/:id/attachments/upload-url`). `body` may be omitted /
 * empty only when an attachment is present.
 */
export const sendMessageBodySchema = z
  .object({
    body: z.string().trim().max(MESSAGE_BODY_MAX).optional(),
    // Clients may only send TEXT; SYSTEM is server-reserved.
    type: z.literal('TEXT').default('TEXT'),
    attachment: z
      .object({
        kind: z.enum(CHAT_ATTACHMENT_KINDS),
        storageKey: z.string().trim().min(1).max(1024),
        fileName: z.string().trim().min(1).max(CHAT_ATTACHMENT_FILENAME_MAX),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.body && v.body.length > 0) || Boolean(v.attachment), {
    message: 'Provide message text or an attachment',
    path: ['body'],
  });

export const attachmentUploadUrlBodySchema = z
  .object({
    kind: z.enum(CHAT_ATTACHMENT_KINDS),
    filename: z.string().trim().min(1).max(CHAT_ATTACHMENT_FILENAME_MAX),
    mimeType: z.string().trim().min(1).max(255),
    size: z.number().int().positive(),
  })
  .strict();
export type AttachmentUploadUrlBody = z.infer<typeof attachmentUploadUrlBodySchema>;

export const conversationMessageParamSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const markReadBodySchema = z.object({ messageId: z.string().uuid() }).strict();

export const listConversationsQuerySchema = paginationQuerySchema.extend({
  organizationId: z.string().uuid().optional(),
});

export const listMessagesQuerySchema = paginationQuerySchema;

export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;
export type MarkReadBody = z.infer<typeof markReadBodySchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
