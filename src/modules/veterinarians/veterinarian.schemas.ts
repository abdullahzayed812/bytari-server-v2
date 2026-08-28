import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';

export const applyBodySchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type ApplyBody = z.infer<typeof applyBodySchema>;

export const rejectBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type RejectBody = z.infer<typeof rejectBodySchema>;

export const pendingQuerySchema = paginationQuerySchema;
export type PendingQuery = z.infer<typeof pendingQuerySchema>;
