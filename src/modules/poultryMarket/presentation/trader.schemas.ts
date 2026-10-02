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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayString = z
  .string()
  .regex(DATE_RE, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

/** The trader's activation period (both dates, or neither → one year from today). */
export const traderSubscriptionBodySchema = z
  .object({ startDate: dayString, endDate: dayString })
  .strict()
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });
export type TraderSubscriptionBody = z.infer<typeof traderSubscriptionBodySchema>;

/** Approve body — optional activation period (defaults to one year from today). */
export const approveTraderBodySchema = z
  .object({ subscription: traderSubscriptionBodySchema.optional() })
  .strict()
  .optional();
export type ApproveTraderBody = z.infer<typeof approveTraderBodySchema>;

export const listTradersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TRADER_STATUSES).optional(),
});
export type ListTradersQuery = z.infer<typeof listTradersQuerySchema>;

export const adminUpdateTraderBodySchema = z
  .object({
    displayName: z.string().trim().min(2).max(160).optional(),
    traderType: z.enum(TRADER_TYPES).optional(),
    governorate: z.string().trim().min(1).max(120).optional(),
    district: z.string().trim().max(120).nullable().optional(),
    phone: phoneSchema.optional(),
    whatsapp: phoneSchema.nullable().optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type AdminUpdateTraderBody = z.infer<typeof adminUpdateTraderBodySchema>;
