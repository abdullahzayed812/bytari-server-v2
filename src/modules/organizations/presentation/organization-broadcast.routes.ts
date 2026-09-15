import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from './organization.middleware.js';
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
  const ctrl = new OrganizationBroadcastController(c.organizationBroadcastService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  r.post(
    '/:organizationId/broadcast/image-upload-url',
    validate({ params: organizationBroadcastParamSchema, body: organizationBroadcastImageUploadUrlBodySchema }),
    withOrganization,
    authorizeOrg('organization.broadcast.send'),
    asyncHandler(ctrl.requestImageUploadUrl),
  );
  r.post(
    '/:organizationId/broadcast',
    validate({ params: organizationBroadcastParamSchema, body: sendOrganizationBroadcastBodySchema }),
    withOrganization,
    authorizeOrg('organization.broadcast.send'),
    asyncHandler(ctrl.send),
  );

  return r;
}
