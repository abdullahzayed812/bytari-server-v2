import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { RENEWAL_REQUEST_STATUSES } from '../domain/farm-subscription.types.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const uuid = z.string().uuid();

export const organizationParamSchema = z.object({ organizationId: uuid });
export const renewalRequestParamSchema = z.object({ organizationId: uuid, requestId: uuid });

// --- member-facing (owner / supervisor / admin) ---------------------

export const setSubscriptionBodySchema = z.object({
  startDate: isoDate,
  endDate: isoDate,
});
export type SetSubscriptionBody = z.infer<typeof setSubscriptionBodySchema>;

export const createRenewalRequestBodySchema = z
  .object({ note: z.string().trim().max(1000).optional() })
  .default({});
export type CreateRenewalRequestBody = z.infer<typeof createRenewalRequestBodySchema>;

export const approveRenewalBodySchema = z.object({
  startDate: isoDate,
  endDate: isoDate,
});
export type ApproveRenewalBody = z.infer<typeof approveRenewalBodySchema>;

export const rejectRenewalBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type RejectRenewalBody = z.infer<typeof rejectRenewalBodySchema>;

export const listRenewalRequestsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RENEWAL_REQUEST_STATUSES).optional(),
});
export type ListRenewalRequestsQuery = z.infer<typeof listRenewalRequestsQuerySchema>;

// --- admin -----------------------------------------------------------

export const adminListFarmsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED']).optional(),
  subscriptionStatus: z.enum(['NOT_STARTED', 'ACTIVE', 'EXPIRED']).optional(),
  /**
   * Narrow the list to one species family so the admin can review poultry and
   * livestock farm requests separately. `LIVESTOCK` = `farm_species IN
   * ('SHEEP','CATTLE')`; `POULTRY` = everything else (`POULTRY`, `MIXED`, and
   * legacy null-species farms) — a clean partition so no request is orphaned.
   */
  speciesGroup: z.enum(['POULTRY', 'LIVESTOCK']).optional(),
});
export type AdminListFarmsQuery = z.infer<typeof adminListFarmsQuerySchema>;

export const adminFarmParamSchema = z.object({ id: uuid });
export const adminFarmRenewalRequestParamSchema = z.object({ id: uuid, requestId: uuid });
