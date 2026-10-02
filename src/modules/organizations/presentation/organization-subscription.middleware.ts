import type { RequestHandler } from 'express';
import { BadRequestError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import { computeFarmSubscriptionStatus } from '../domain/organization.types.js';
import { requireOrganization } from './organization.middleware.js';

/**
 * MUST run after `withOrganization`. Gates the generic
 * `/organizations/:id/subscription...` routes to the organization types that use them —
 * VETERINARY_OFFICE and CLINIC (spec §3: same approval/subscription concept as Farms,
 * reusing the Farm infrastructure). FARM keeps its own dedicated
 * `/organizations/:id/farm/subscription...` routes (`withFarmOrganization`) — this
 * middleware rejects FARM here so there is exactly one subscription entry point per type.
 */
const SUBSCRIPTION_CAPABLE_TYPES = new Set(['VETERINARY_OFFICE', 'CLINIC']);

export const withSubscriptionCapableOrganization: RequestHandler = asyncHandler(
  (req, _res, next) => {
    const org = requireOrganization(req);
    if (!SUBSCRIPTION_CAPABLE_TYPES.has(org.type)) {
      throw new BadRequestError(
        'This operation is only available for veterinary office or clinic organizations',
        { code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED },
      );
    }
    next();
  },
);

/**
 * MUST run after `withOrganization`. A CLINIC / VETERINARY_OFFICE whose
 * subscription has EXPIRED cannot operate — no product management, no
 * follower broadcasts — until it is renewed (final corrections §10). Other
 * organization types pass through (FARM has its own `requireActiveFarmSubscription`).
 * A global ADMIN bypasses, like every other organization gate.
 */
export function createOrganizationSubscriptionGuard(deps: {
  subscriptions: {
    getSubscriptionDates(
      organizationId: string,
    ): Promise<{ startDate: string | null; endDate: string | null }>;
  };
  authz: AuthorizationService;
}): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    if (!SUBSCRIPTION_CAPABLE_TYPES.has(org.type)) return next();
    if (deps.authz.isAdmin(requireAuth(req))) return next();
    const dates = await deps.subscriptions.getSubscriptionDates(org.id);
    if (computeFarmSubscriptionStatus(dates.startDate, dates.endDate) === 'EXPIRED') {
      throw new ForbiddenError(
        'This organization’s subscription has expired — renew it to continue',
        { code: ErrorCode.ORGANIZATION_SUBSCRIPTION_EXPIRED },
      );
    }
    next();
  });
}
