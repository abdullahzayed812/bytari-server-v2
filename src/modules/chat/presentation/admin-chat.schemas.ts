import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';

export const listAdminConversationsQuerySchema = paginationQuerySchema;
export type ListAdminConversationsQuery = z.infer<typeof listAdminConversationsQuerySchema>;

export const adminConversationIdParamSchema = z
  .object({ conversationId: z.string().uuid() })
  .strict();

export const listAdminConversationMessagesQuerySchema = paginationQuerySchema;
export type ListAdminConversationMessagesQuery = z.infer<
  typeof listAdminConversationMessagesQuerySchema
>;
