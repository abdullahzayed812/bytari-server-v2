import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { MESSAGE_BODY_MAX } from '../domain/chat.constants.js';

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

export const sendMessageBodySchema = z
  .object({
    body: z.string().trim().min(1).max(MESSAGE_BODY_MAX),
    // Clients may only send TEXT; SYSTEM is server-reserved.
    type: z.literal('TEXT').default('TEXT'),
  })
  .strict();

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
