import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';

export const listAuditQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(64).optional(),
  entityType: z.string().max(64).optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
