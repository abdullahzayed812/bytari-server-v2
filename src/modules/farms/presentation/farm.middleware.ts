import type { RequestHandler } from 'express';
import { BadRequestError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import { computeFarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';
import { FARM_ORG_TYPE } from '../domain/farm.constants.js';
import type { FarmSubscriptionRenewalRepository } from '../infrastructure/farm-subscription-renewal.repository.js';

/**
 * MUST run after `withOrganization`. Rejects any organization that is not a
 * FARM (`400`) — the poultry / operations routes are farm-only. The type comes
 * from the resolved organization, never the request body.
 */
export const withFarmOrganization: RequestHandler = asyncHandler((req, _res, next) => {
  const org = requireOrganization(req);
  if (org.type !== FARM_ORG_TYPE) {
    throw new BadRequestError('This operation is only available for farm organizations', {
      code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
    });
  }
  next();
});

/**
 * MUST run after `withOrganization` (+ `withFarmOrganization`). Blocks every
 * day-to-day farm operation (flocks, daily records, expenses, health events,
 * appointments, cases, profile edits) unless the farm's subscription is
 * currently ACTIVE — never PENDING/EXPIRED (spec: "do not allow any operation
 * while the subscription is expired or not yet started"). A global ADMIN
 * bypasses this, same as every other organization gate.
 */
export function createFarmSubscriptionMiddleware(deps: {
  subscriptions: FarmSubscriptionRenewalRepository;
  authz: AuthorizationService;
}): {
  requireActiveFarmSubscription: RequestHandler;
} {
  const requireActiveFarmSubscription: RequestHandler = asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    // Non-FARM organizations have no `farm_details` row at all — leave the
    // 400 ORGANIZATION_TYPE_NOT_SUPPORTED to `withFarmOrganization` / the
    // application layer rather than misreport this as a subscription issue.
    if (org.type !== FARM_ORG_TYPE) return next();

    const principal = requireAuth(req);
    if (deps.authz.isAdmin(principal)) return next();

    const dates = await deps.subscriptions.getSubscriptionDates(org.id);
    const status = computeFarmSubscriptionStatus(dates.startDate, dates.endDate);
    if (status !== 'ACTIVE') {
      throw new ForbiddenError(
        'This farm’s subscription is not active — operations are restricted',
        { code: ErrorCode.FARM_SUBSCRIPTION_NOT_ACTIVE },
      );
    }
    next();
  });

  return { requireActiveFarmSubscription };
}
