import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import { idParamSchema } from '../../../shared/validation/common.js';
import type { Container } from '../../../container.js';
import { AdminOrganizationController } from './admin-organization.controller.js';
import {
  adminListOrganizationsQuerySchema,
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
  );
  const { authorize } = c.authorization;
  const r = Router();
  r.use(c.authenticate);

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

  return r;
}
