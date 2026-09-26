import type { Request } from 'express';
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
export function stripFinancialInput<T extends { targetPricePerKg?: unknown }>(body: T, visible: boolean): T {
  if (visible || body.targetPricePerKg === undefined) return body;
  const { targetPricePerKg: _dropped, ...rest } = body;
  return rest as T;
}
