import { Router } from 'express';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import { idParamSchema } from '../../../shared/validation/common.js';
import type { Container } from '../../../container.js';
import {
  adminFarmRenewalRequestParamSchema,
  adminListFarmsQuerySchema,
  approveRenewalBodySchema,
  rejectRenewalBodySchema,
  setSubscriptionBodySchema,
} from '../../farms/presentation/farm-subscription.schemas.js';
import { AdminOrganizationController } from './admin-organization.controller.js';
import { AdminOrganizationReviewController } from './admin-organization-review.controller.js';
import {
  adminDeleteReviewBodySchema,
  adminListOrganizationsQuerySchema,
  adminListReviewsQuerySchema,
  rejectOrganizationBodySchema,
  statusChangeBodySchema,
} from './organization.schemas.js';

const orgMemberParamSchema = z.object({
  id: z.string().uuid(),
  memberId: z.string().uuid(),
});

/** Mounts `/admin/organizations/*`. */
export function createAdminOrganizationRouter(c: Container): Router {
  const ctrl = new AdminOrganizationController(
    c.organizationService,
    c.organizationRepository,
    c.membershipService,
    c.organizationSupervisorService,
    c.farmSubscriptionRenewalRepository,
    c.farmSubscriptionService,
    c.userService,
  );
  /**
   * `authorize()` for the organization-admin keys, TYPE-SCOPED for system
   * supervisors (`AuthorizationService.canForOrganizationType`): the target
   * type comes from the organization in `:id`, a fixed type for type-specific
   * routes, or the `?type=` filter. 403 when outside the caller's sections.
   */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const orgAdmin = (permission: string, fixedType?: string) =>
    asyncHandler(async (req, _res, next) => {
      const principal = requireAuth(req);
      let orgType: string | null = fixedType ?? null;
      const id = req.params.id;
      if (!orgType && typeof id === 'string') {
        if (!UUID_RE.test(id)) throw new NotFoundError('Organization not found');
        const org = await c.organizationRepository.findById(id);
        if (!org) throw new NotFoundError('Organization not found');
        orgType = org.type;
      }
      if (!orgType && typeof req.query.type === 'string') orgType = req.query.type;
      if (await c.authorizationService.canForOrganizationType(principal, permission, orgType)) {
        next();
        return;
      }
      throw new ForbiddenError(`Missing required permission: ${permission}`, {
        code: ErrorCode.PERMISSION_DENIED,
      });
    });
  const r = Router();
  r.use(c.authenticate);

  // --- review moderation (clinics / offices / stores). BEFORE `/:id`. ---
  const reviews = new AdminOrganizationReviewController(c.organizationEngagementService);
  r.get(
    '/reviews',
    orgAdmin('organization.admin.read', 'CLINIC'),
    validate({ query: adminListReviewsQuerySchema }),
    asyncHandler(reviews.list),
  );
  r.delete(
    '/reviews/:id',
    orgAdmin('organization.admin.manage', 'CLINIC'),
    validate({ params: idParamSchema, body: adminDeleteReviewBodySchema }),
    asyncHandler(reviews.remove),
  );

  // Mounted BEFORE `/:id` so `/farms` is never parsed as an org id.
  r.get(
    '/farms',
    orgAdmin('organization.admin.read', 'FARM'),
    validate({ query: adminListFarmsQuerySchema }),
    asyncHandler(ctrl.listFarms),
  );

  // Cross-organization pending renewal requests — admin dashboard "pending
  // tasks". A two-segment path, so it can never collide with `/:id`.
  r.get(
    '/subscription-renewals/pending',
    orgAdmin('organization.admin.read'),
    validate({ query: adminListOrganizationsQuerySchema }),
    asyncHandler(ctrl.listPendingRenewals),
  );

  r.get(
    '/',
    orgAdmin('organization.admin.read'),
    validate({ query: adminListOrganizationsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.get(
    '/pending',
    orgAdmin('organization.admin.read'),
    validate({ query: adminListOrganizationsQuerySchema }),
    asyncHandler(ctrl.pending),
  );
  r.get(
    '/:id',
    orgAdmin('organization.admin.read'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.getOne),
  );
  r.get(
    '/:id/members',
    orgAdmin('organization.admin.read'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.listMembers),
  );

  r.post(
    '/:id/approve',
    orgAdmin('organization.admin.approve'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.approve),
  );
  r.post(
    '/:id/reject',
    orgAdmin('organization.admin.approve'),
    validate({ params: idParamSchema, body: rejectOrganizationBodySchema }),
    asyncHandler(ctrl.reject),
  );
  r.post(
    '/:id/suspend',
    orgAdmin('organization.admin.status'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.suspend),
  );
  r.post(
    '/:id/activate',
    orgAdmin('organization.admin.status'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.activate),
  );
  r.post(
    '/:id/deactivate',
    orgAdmin('organization.admin.status'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.deactivate),
  );

  r.delete(
    '/:id',
    orgAdmin('organization.admin.status'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.remove),
  );
  r.delete(
    '/:id/members/:memberId',
    orgAdmin('organization.admin.manage'),
    validate({ params: orgMemberParamSchema }),
    asyncHandler(ctrl.removeMember),
  );
  r.delete(
    '/:id/supervisors/:memberId',
    orgAdmin('organization.admin.manage'),
    validate({ params: orgMemberParamSchema }),
    asyncHandler(ctrl.removeSupervisor),
  );

  // --- Poultry Farms: subscription + renewal requests -----------------
  r.get(
    '/:id/subscription-renewals',
    orgAdmin('organization.admin.read'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.listFarmSubscriptionRenewals),
  );
  r.post(
    '/:id/subscription',
    orgAdmin('organization.admin.subscription'),
    validate({ params: idParamSchema, body: setSubscriptionBodySchema }),
    asyncHandler(ctrl.setFarmSubscription),
  );
  r.post(
    '/:id/subscription-renewals/:requestId/approve',
    orgAdmin('organization.admin.subscription'),
    validate({ params: adminFarmRenewalRequestParamSchema, body: approveRenewalBodySchema }),
    asyncHandler(ctrl.approveFarmRenewal),
  );
  r.post(
    '/:id/subscription-renewals/:requestId/reject',
    orgAdmin('organization.admin.subscription'),
    validate({ params: adminFarmRenewalRequestParamSchema, body: rejectRenewalBodySchema }),
    asyncHandler(ctrl.rejectFarmRenewal),
  );

  return r;
}
