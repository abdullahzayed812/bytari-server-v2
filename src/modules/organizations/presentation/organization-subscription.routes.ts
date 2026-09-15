import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  approveRenewalBodySchema,
  createRenewalRequestBodySchema,
  listRenewalRequestsQuerySchema,
  organizationParamSchema,
  rejectRenewalBodySchema,
  renewalRequestParamSchema,
  setSubscriptionBodySchema,
} from '../../farms/presentation/farm-subscription.schemas.js';
import { createOrganizationMiddleware } from './organization.middleware.js';
import { OrganizationSubscriptionController } from './organization-subscription.controller.js';
import { withSubscriptionCapableOrganization } from './organization-subscription.middleware.js';

/**
 * Subscription routes for VETERINARY_OFFICE / CLINIC organizations — the generalized
 * counterpart of `poultry-ops.routes.ts`'s farm-only `/organizations/:id/farm/subscription...`
 * block (spec §3: reuse, don't duplicate). Same handlers/schemas/RBAC keys
 * (`farm.subscription.read` / `farm.subscription.manage`) and the same
 * `excludeOwner: true` rule — the owner can request a renewal but never approve their own.
 * Mounted at `/organizations`, alongside the Phase 3 organization router.
 */
export function createOrganizationSubscriptionRouter(c: Container): Router {
  const ctrl = new OrganizationSubscriptionController(c.farmSubscriptionService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  const org = [withOrganization, withSubscriptionCapableOrganization] as const;
  const base = '/:organizationId/subscription-renewals';

  r.get(
    base,
    validate({ params: organizationParamSchema, query: listRenewalRequestsQuerySchema }),
    ...org,
    authorizeOrg('farm.subscription.read', { allowInactiveForOwner: true }),
    asyncHandler(ctrl.listRenewals),
  );
  r.post(
    base,
    validate({ params: organizationParamSchema, body: createRenewalRequestBodySchema }),
    ...org,
    authorizeOrg('farm.subscription.read', { allowInactiveForOwner: true }),
    asyncHandler(ctrl.createRenewal),
  );
  r.post(
    '/:organizationId/subscription',
    validate({ params: organizationParamSchema, body: setSubscriptionBodySchema }),
    ...org,
    authorizeOrg('farm.subscription.manage', { excludeOwner: true }),
    asyncHandler(ctrl.setSubscription),
  );
  r.post(
    `${base}/:requestId/approve`,
    validate({ params: renewalRequestParamSchema, body: approveRenewalBodySchema }),
    ...org,
    authorizeOrg('farm.subscription.manage', { excludeOwner: true }),
    asyncHandler(ctrl.approveRenewal),
  );
  r.post(
    `${base}/:requestId/reject`,
    validate({ params: renewalRequestParamSchema, body: rejectRenewalBodySchema }),
    ...org,
    authorizeOrg('farm.subscription.manage', { excludeOwner: true }),
    asyncHandler(ctrl.rejectRenewal),
  );

  return r;
}
