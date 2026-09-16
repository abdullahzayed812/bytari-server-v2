import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { REPORT_REASONS, REPORT_STATUSES, REPORT_TARGET_TYPES } from '../domain/report.types.js';

export const reportIdParamSchema = z.object({ reportId: z.string().uuid() });

export const submitReportBodySchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(2000).nullable().optional(),
});
export type SubmitReportBody = z.infer<typeof submitReportBodySchema>;

export const listReportsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(REPORT_STATUSES).optional(),
  targetType: z.enum(REPORT_TARGET_TYPES).optional(),
});
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

export const reviewReportBodySchema = z.object({
  status: z.enum(['REVIEWED', 'DISMISSED']),
});
export type ReviewReportBody = z.infer<typeof reviewReportBodySchema>;
