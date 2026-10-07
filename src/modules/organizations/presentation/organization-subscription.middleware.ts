import type { RequestHandler } from 'express';
import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import {
  OrganizationOperabilityService,
  type SubscriptionDatesSource,
} from '../application/organization-operability.service.js';
import { SUBSCRIPTION_GATED_ORG_TYPES } from '../domain/organization-operability.js';
import { requireOrganization } from './organization.middleware.js';

/**
 * MUST run after `withOrganization`. Gates the generic
 * `/organizations/:id/subscription...` routes to the organization types that use them —
 * VETERINARY_OFFICE and CLINIC (spec §3: same approval/subscription concept as Farms,
 * reusing the Farm infrastructure). FARM keeps its own dedicated
 * `/organizations/:id/farm/subscription...` routes (`withFarmOrganization`) — this
 * middleware rejects FARM here so there is exactly one subscription entry point per type.
 */
const SUBSCRIPTION_CAPABLE_TYPES = SUBSCRIPTION_GATED_ORG_TYPES;

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
 * MUST run after `withOrganization` + `authorizeOrg` (which already enforces
 * the ACTIVE organization status). A CLINIC / VETERINARY_OFFICE whose
 * subscription has EXPIRED cannot operate until it is renewed — the decision
 * comes from `computeOrganizationOperability`, the single source of truth also
 * used by chat (incl. realtime rooms) and appointment booking. Other
 * organization types pass through (FARM has `requireActiveFarmSubscription`).
 * A global ADMIN bypasses, like every other organization gate.
 *
 * `types` narrows the gate (e.g. clinic-only member management, so Veterinary
 * Office behaviour is unchanged).
 */
export function createOrganizationSubscriptionGuard(deps: {
  subscriptions: SubscriptionDatesSource;
  authz: AuthorizationService;
  types?: readonly string[];
}): RequestHandler {
  const operability = new OrganizationOperabilityService(deps.subscriptions, deps.authz);
  const gated = new Set(deps.types ?? [...SUBSCRIPTION_GATED_ORG_TYPES]);
  return asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    if (!gated.has(org.type)) return next();
    // `authorizeOrg` owns the status gate (incl. its owner exceptions), so only
    // the subscription part is decided here — through the shared rule.
    await operability.assertOperational(requireAuth(req), { ...org, status: 'ACTIVE' });
    next();
  });
}
