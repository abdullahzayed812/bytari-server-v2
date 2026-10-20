import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { CONVERSATION_STATUSES, CONVERSATION_TYPES } from '../domain/chat.constants.js';

/** Admin conversation list — search by conversation / participant name + type / status filters. */
export const listAdminConversationsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  type: z.enum(CONVERSATION_TYPES).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  organizationId: z.string().uuid().optional(),
});
export type ListAdminConversationsQuery = z.infer<typeof listAdminConversationsQuerySchema>;

export const adminConversationIdParamSchema = z
  .object({ conversationId: z.string().uuid() })
  .strict();

export const listAdminConversationMessagesQuerySchema = paginationQuerySchema;
export type ListAdminConversationMessagesQuery = z.infer<
  typeof listAdminConversationMessagesQuerySchema
>;
