import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { RENEWAL_REQUEST_STATUSES } from '../domain/farm-subscription.types.js';
import { dateOnlySchema } from '../../../shared/validation/date-only.js';

const isoDate = dateOnlySchema();
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
   * Narrow the list to one species family so the admin can review poultry,
   * sheep and cattle farms separately (`LIVESTOCK` = sheep + cattle, kept for
   * older clients). A `MIXED` farm is listed under every species it actually
   * holds batches/flocks of; a MIXED farm with none yet (and legacy
   * null-species farms) stays under `POULTRY` so no request is orphaned.
   */
  speciesGroup: z.enum(['POULTRY', 'LIVESTOCK', 'SHEEP', 'CATTLE']).optional(),
});
export type AdminListFarmsQuery = z.infer<typeof adminListFarmsQuerySchema>;

export const adminFarmParamSchema = z.object({ id: uuid });
export const adminFarmRenewalRequestParamSchema = z.object({ id: uuid, requestId: uuid });
