import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { phoneSchema } from '../../../shared/validation/common.js';
import { TRADER_STATUSES, TRADER_TYPES } from '../domain/trader.constants.js';

export const registerTraderBodySchema = z.object({
  displayName: z.string().trim().min(2).max(160),
  traderType: z.enum(TRADER_TYPES).default('WHOLESALE'),
  governorate: z.string().trim().min(1).max(120),
  district: z.string().trim().max(120).optional(),
  phone: phoneSchema,
  whatsapp: phoneSchema.optional(),
  bio: z.string().trim().max(2000).optional(),
  termsAccepted: z.literal(true, { message: 'يجب الموافقة على الشروط والأحكام' }),
});
export type RegisterTraderBody = z.infer<typeof registerTraderBodySchema>;

export const rejectTraderBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type RejectTraderBody = z.infer<typeof rejectTraderBodySchema>;

export const suspendTraderBodySchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export type SuspendTraderBody = z.infer<typeof suspendTraderBodySchema>;

export const listTradersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TRADER_STATUSES).optional(),
});
export type ListTradersQuery = z.infer<typeof listTradersQuerySchema>;
