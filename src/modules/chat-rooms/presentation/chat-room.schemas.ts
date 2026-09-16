import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';

export const organizationIdParamSchema = z.object({ organizationId: z.string().uuid() });
export const organizationAndMessageIdParamSchema = z.object({
  organizationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const listChatRoomsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(160).optional(),
});
export type ListChatRoomsQuery = z.infer<typeof listChatRoomsQuerySchema>;

export const listChatRoomMembersQuerySchema = paginationQuerySchema;
export type ListChatRoomMembersQuery = z.infer<typeof listChatRoomMembersQuerySchema>;

export const createChatRoomBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  rules: z.string().trim().max(4000).nullable().optional(),
});
export type CreateChatRoomBody = z.infer<typeof createChatRoomBodySchema>;

export const updateChatRoomRulesBodySchema = z.object({
  rules: z.string().trim().max(4000).nullable(),
});
export type UpdateChatRoomRulesBody = z.infer<typeof updateChatRoomRulesBodySchema>;

export const setMutedBodySchema = z.object({
  muted: z.boolean(),
});
export type SetMutedBody = z.infer<typeof setMutedBodySchema>;
