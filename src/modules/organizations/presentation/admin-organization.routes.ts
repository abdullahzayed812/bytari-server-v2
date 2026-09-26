import { Router } from 'express';
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
  );
  const { authorize } = c.authorization;
  const r = Router();
  r.use(c.authenticate);

  // --- review moderation (clinics / offices / stores). BEFORE `/:id`. ---
  const reviews = new AdminOrganizationReviewController(c.organizationEngagementService);
  r.get(
    '/reviews',
    authorize('organization.admin.read'),
    validate({ query: adminListReviewsQuerySchema }),
    asyncHandler(reviews.list),
  );
  r.delete(
    '/reviews/:id',
    authorize('organization.admin.manage'),
    validate({ params: idParamSchema, body: adminDeleteReviewBodySchema }),
    asyncHandler(reviews.remove),
  );

  // Mounted BEFORE `/:id` so `/farms` is never parsed as an org id.
  r.get(
    '/farms',
    authorize('organization.admin.read'),
    validate({ query: adminListFarmsQuerySchema }),
    asyncHandler(ctrl.listFarms),
  );

  // Cross-organization pending renewal requests — admin dashboard "pending
  // tasks". A two-segment path, so it can never collide with `/:id`.
  r.get(
    '/subscription-renewals/pending',
    authorize('organization.admin.read'),
    validate({ query: adminListOrganizationsQuerySchema }),
    asyncHandler(ctrl.listPendingRenewals),
  );

  r.get(
    '/',
    authorize('organization.admin.read'),
    validate({ query: adminListOrganizationsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.get(
    '/pending',
    authorize('organization.admin.read'),
    validate({ query: adminListOrganizationsQuerySchema }),
    asyncHandler(ctrl.pending),
  );
  r.get(
    '/:id',
    authorize('organization.admin.read'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.getOne),
  );
  r.get(
    '/:id/members',
    authorize('organization.admin.read'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.listMembers),
  );

  r.post(
    '/:id/approve',
    authorize('organization.admin.approve'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.approve),
  );
  r.post(
    '/:id/reject',
    authorize('organization.admin.approve'),
    validate({ params: idParamSchema, body: rejectOrganizationBodySchema }),
    asyncHandler(ctrl.reject),
  );
  r.post(
    '/:id/suspend',
    authorize('organization.admin.status'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.suspend),
  );
  r.post(
    '/:id/activate',
    authorize('organization.admin.status'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.activate),
  );
  r.post(
    '/:id/deactivate',
    authorize('organization.admin.status'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.deactivate),
  );

  r.delete(
    '/:id/members/:memberId',
    authorize('organization.admin.manage'),
    validate({ params: orgMemberParamSchema }),
    asyncHandler(ctrl.removeMember),
  );
  r.delete(
    '/:id/supervisors/:memberId',
    authorize('organization.admin.manage'),
    validate({ params: orgMemberParamSchema }),
    asyncHandler(ctrl.removeSupervisor),
  );

  // --- Poultry Farms: subscription + renewal requests -----------------
  r.get(
    '/:id/subscription-renewals',
    authorize('organization.admin.read'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.listFarmSubscriptionRenewals),
  );
  r.post(
    '/:id/subscription',
    authorize('organization.admin.subscription'),
    validate({ params: idParamSchema, body: setSubscriptionBodySchema }),
    asyncHandler(ctrl.setFarmSubscription),
  );
  r.post(
    '/:id/subscription-renewals/:requestId/approve',
    authorize('organization.admin.subscription'),
    validate({ params: adminFarmRenewalRequestParamSchema, body: approveRenewalBodySchema }),
    asyncHandler(ctrl.approveFarmRenewal),
  );
  r.post(
    '/:id/subscription-renewals/:requestId/reject',
    authorize('organization.admin.subscription'),
    validate({ params: adminFarmRenewalRequestParamSchema, body: rejectRenewalBodySchema }),
    asyncHandler(ctrl.rejectFarmRenewal),
  );

  return r;
}
