import type { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';

export const listAdminConversationsQuerySchema = paginationQuerySchema;
export type ListAdminConversationsQuery = z.infer<typeof listAdminConversationsQuerySchema>;
