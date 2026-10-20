import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import { dateBoundSchema } from '../../shared/validation/date-only.js';

export const listAuditQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(64).optional(),
  entityType: z.string().max(64).optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  /** `YYYY-M-D` / `YYYY-MM-DD` (whole Baghdad day) or a full ISO date-time. */
  from: dateBoundSchema('start').optional(),
  to: dateBoundSchema('end').optional(),
  search: z.string().trim().min(1).max(160).optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export const auditIdParamsSchema = z.object({ id: z.string().uuid() });
export type AuditIdParams = z.infer<typeof auditIdParamsSchema>;
