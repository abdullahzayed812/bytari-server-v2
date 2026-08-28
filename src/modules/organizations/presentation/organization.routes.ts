import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { OrganizationController } from './organization.controller.js';
import {
  createOrganizationMiddleware,
  organizationIdParamSchema,
} from './organization.middleware.js';
import {
  addMemberBodySchema,
  assignSupervisorBodySchema,
  createOrganizationBodySchema,
  listMembersQuerySchema,
  listMyOrganizationsQuerySchema,
  organizationMemberParamSchema,
  organizationSupervisorParamSchema,
  updateMemberBodySchema,
  updateOrganizationBodySchema,
  updateSupervisorBodySchema,
} from './organization.schemas.js';

/** Mounts `/organizations/*` (member-facing, organization-scoped). */
export function createOrganizationRouter(c: Container): Router {
  const ctrl = new OrganizationController(
    c.organizationService,
    c.membershipService,
    c.organizationSupervisorService,
    c.authorizationService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const r = Router();
  r.use(c.authenticate);

  // --- collection ---------------------------------------------------
  r.post('/', validate({ body: createOrganizationBodySchema }), asyncHandler(ctrl.create));
  r.get('/', validate({ query: listMyOrganizationsQuerySchema }), asyncHandler(ctrl.listMine));

  // --- single organization ------------------------------------
  r.get(
    '/:organizationId',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    authorizeOrg('organization.read'),
    asyncHandler(ctrl.getOne),
  );
  r.patch(
    '/:organizationId',
    validate({ params: organizationIdParamSchema, body: updateOrganizationBodySchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.update),
  );
  r.post(
    '/:organizationId/leave',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    asyncHandler(ctrl.leave),
  );

  // --- members ------------------------------------------------------
  r.get(
    '/:organizationId/members',
    validate({ params: organizationIdParamSchema, query: listMembersQuerySchema }),
    withOrganization,
    authorizeOrg('member.read'),
    asyncHandler(ctrl.listMembers),
  );
  r.post(
    '/:organizationId/members',
    validate({ params: organizationIdParamSchema, body: addMemberBodySchema }),
    withOrganization,
    authorizeOrg('member.add'),
    asyncHandler(ctrl.addMember),
  );
  r.get(
    '/:organizationId/members/:memberId',
    validate({ params: organizationMemberParamSchema }),
    withOrganization,
    authorizeOrg('member.read'),
    asyncHandler(ctrl.getMember),
  );
  r.patch(
    '/:organizationId/members/:memberId',
    validate({ params: organizationMemberParamSchema, body: updateMemberBodySchema }),
    withOrganization,
    authorizeOrg('member.update'),
    asyncHandler(ctrl.updateMember),
  );
  r.delete(
    '/:organizationId/members/:memberId',
    validate({ params: organizationMemberParamSchema }),
    withOrganization,
    authorizeOrg('member.remove'),
    asyncHandler(ctrl.removeMember),
  );

  // --- supervisors ------------------------------------------
  r.get(
    '/:organizationId/supervisors',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    authorizeOrg('supervisor.read'),
    asyncHandler(ctrl.listSupervisors),
  );
  r.post(
    '/:organizationId/supervisors',
    validate({ params: organizationIdParamSchema, body: assignSupervisorBodySchema }),
    withOrganization,
    authorizeOrg('supervisor.assign'),
    asyncHandler(ctrl.assignSupervisor),
  );
  r.patch(
    '/:organizationId/supervisors/:membershipId',
    validate({ params: organizationSupervisorParamSchema, body: updateSupervisorBodySchema }),
    withOrganization,
    authorizeOrg('supervisor.assign'),
    asyncHandler(ctrl.updateSupervisor),
  );
  r.delete(
    '/:organizationId/supervisors/:membershipId',
    validate({ params: organizationSupervisorParamSchema }),
    withOrganization,
    authorizeOrg('supervisor.remove'),
    asyncHandler(ctrl.removeSupervisor),
  );

  return r;
}
