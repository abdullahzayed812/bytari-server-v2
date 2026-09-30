import type { Request } from 'express';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';

/**
 * Farm financial visibility (estimated profit + the expected sale price that
 * drives it). Held by the farm OWNER (org-owner override) and ADMIN; a
 * veterinarian / employee sees operational data only — unless the owner
 * explicitly grants `farm.financials.read` to a supervisor membership.
 * Enforced HERE, in the response DTO, not just by hiding UI.
 */
export const FARM_FINANCIALS_PERMISSION = 'farm.financials.read';

export function canSeeFarmFinancials(
  authz: AuthorizationService,
  req: Request,
  organizationId: string,
): Promise<boolean> {
  return authz.canInOrganization(requireAuth(req), FARM_FINANCIALS_PERMISSION, organizationId);
}

interface FinancialFields {
  estimatedProfit?: number | null;
  targetPricePerKg?: string | number | null;
}

/** Null out financial fields for a caller without `farm.financials.read`; flag the result either way. */
export function applyFinancialVisibility<T extends FinancialFields>(
  dto: T,
  visible: boolean,
): T & { financialsVisible: boolean } {
  if (visible) return { ...dto, financialsVisible: true };
  const redacted: T = { ...dto };
  if ('estimatedProfit' in redacted) redacted.estimatedProfit = null;
  if ('targetPricePerKg' in redacted) redacted.targetPricePerKg = null;
  return { ...redacted, financialsVisible: false };
}

/** A caller without the permission may not SET the sale price either — the field is dropped. */
export function stripFinancialInput<T extends { targetPricePerKg?: unknown }>(
  body: T,
  visible: boolean,
): T {
  if (visible || body.targetPricePerKg === undefined) return body;
  const { targetPricePerKg: _dropped, ...rest } = body;
  return rest as T;
}

/**
 * Selling a batch is a status change (ACTIVE → CLOSED, or reopening it) on the
 * batch PATCH. `farm.*.update` alone (farm veterinarians) does NOT allow it —
 * it needs the owner-level `farm.batch.sell` (OWNER override / ADMIN /
 * explicit supervisor grant). A PATCH that repeats the current status is not a
 * status change.
 */
export const FARM_BATCH_SELL_PERMISSION = 'farm.batch.sell';

export async function assertCanChangeBatchStatus(
  authz: AuthorizationService,
  req: Request,
  organizationId: string,
  currentStatus: string,
  requestedStatus: string | undefined,
): Promise<void> {
  if (requestedStatus === undefined || requestedStatus === currentStatus) return;
  if (await authz.canInOrganization(requireAuth(req), FARM_BATCH_SELL_PERMISSION, organizationId)) {
    return;
  }
  throw new ForbiddenError(`Missing required permission: ${FARM_BATCH_SELL_PERMISSION}`, {
    code: ErrorCode.PERMISSION_DENIED,
  });
}
