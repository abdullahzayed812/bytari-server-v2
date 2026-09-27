import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';

/** Recipient by EMAIL (what the app sends) or, for internal callers, by user id — exactly one. */
export const createTransferRequestBodySchema = z
  .object({
    toUserId: z.string().uuid().optional(),
    toEmail: z.string().trim().toLowerCase().email().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.toUserId) !== Boolean(v.toEmail), {
    message: 'Provide exactly one of toUserId or toEmail',
    path: ['toEmail'],
  });
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
