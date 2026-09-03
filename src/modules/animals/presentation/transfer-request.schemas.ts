import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';

export const createTransferRequestBodySchema = z
  .object({
    toUserId: z.string().uuid(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateTransferRequestBody = z.infer<typeof createTransferRequestBodySchema>;

export const rejectTransferRequestBodySchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type RejectTransferRequestBody = z.infer<typeof rejectTransferRequestBodySchema>;

export const transferRequestIdParamSchema = z.object({
  requestId: z.string().uuid(),
});

export const listTransferRequestsQuerySchema = paginationQuerySchema;
export type ListTransferRequestsQuery = z.infer<typeof listTransferRequestsQuerySchema>;
