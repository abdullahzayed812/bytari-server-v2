import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from './organization.middleware.js';
import { createOrganizationSubscriptionGuard } from './organization-subscription.middleware.js';
import { OrganizationBroadcastController } from './organization-broadcast.controller.js';
import {
  organizationBroadcastImageUploadUrlBodySchema,
  organizationBroadcastParamSchema,
  sendOrganizationBroadcastBodySchema,
} from './organization-broadcast.schemas.js';

/**
 * "إرسال رسالة للمتابعين" — mounted at `/organizations`. Generic across organization
 * types (any org with followers); the Veterinary Office Dashboard is its first caller.
 */
export function createOrganizationBroadcastRouter(c: Container): Router {
  const ctrl = new OrganizationBroadcastController(
    c.organizationBroadcastService,
    c.organizationEngagementService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });

  const activeSubscription = createOrganizationSubscriptionGuard({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  // The dashboard "Followers" page: who follows this organization (names
  // only), each with a "Send Message" action. Visible to whoever may message
  // the followers — the same key as the broadcast (owner / granted supervisor).
  r.get(
    '/:organizationId/followers',
    validate({ params: organizationBroadcastParamSchema, query: paginationQuerySchema }),
    withOrganization,
    authorizeOrg('organization.broadcast.send'),
    activeSubscription,
    asyncHandler(ctrl.listFollowers),
  );

  r.post(
    '/:organizationId/broadcast/image-upload-url',
    validate({
      params: organizationBroadcastParamSchema,
      body: organizationBroadcastImageUploadUrlBodySchema,
    }),
    withOrganization,
    authorizeOrg('organization.broadcast.send'),
    activeSubscription,
    asyncHandler(ctrl.requestImageUploadUrl),
  );
  r.post(
    '/:organizationId/broadcast',
    validate({
      params: organizationBroadcastParamSchema,
      body: sendOrganizationBroadcastBodySchema,
    }),
    withOrganization,
    authorizeOrg('organization.broadcast.send'),
    activeSubscription,
    asyncHandler(ctrl.send),
  );

  return r;
}
