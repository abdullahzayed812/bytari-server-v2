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
  discoverOrganizationsQuerySchema,
  finalizeGalleryBodySchema,
  finalizeLogoBodySchema,
  galleryUploadUrlBodySchema,
  listMembersQuerySchema,
  listMyOrganizationsQuerySchema,
  listReviewsQuerySchema,
  logoUploadUrlBodySchema,
  organizationMemberParamSchema,
  organizationSupervisorParamSchema,
  removeGalleryImageQuerySchema,
  submitReviewBodySchema,
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
    c.organizationEngagementService,
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

  // Discovery — any authenticated user (not just members), e.g. the Pet Owner
  // Home "Available clinics" section. Mounted before `/:organizationId` so
  // `discover` is never parsed as a uuid param.
  r.get(
    '/discover',
    validate({ query: discoverOrganizationsQuerySchema }),
    asyncHandler(ctrl.discover),
  );
  r.get(
    '/discover/:organizationId',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(ctrl.getPublicOne),
  );

  // --- single organization ------------------------------------
  r.get(
    '/:organizationId',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    // The owner must always be able to view their own organization, even
    // while it's PENDING/REJECTED/SUSPENDED (e.g. a farm awaiting approval).
    authorizeOrg('organization.read', { allowInactiveForOwner: true }),
    asyncHandler(ctrl.getOne),
  );
  r.patch(
    '/:organizationId',
    validate({ params: organizationIdParamSchema, body: updateOrganizationBodySchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.update),
  );
  // Logo — same guard as PATCH (`organization.update`); CLINIC / VETERINARY_OFFICE
  // / VETERINARY_STORE only (`OrganizationPolicy.assertHasProfileFields`).
  r.post(
    '/:organizationId/logo/upload-url',
    validate({ params: organizationIdParamSchema, body: logoUploadUrlBodySchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.requestLogoUploadUrl),
  );
  r.post(
    '/:organizationId/logo',
    validate({ params: organizationIdParamSchema, body: finalizeLogoBodySchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.finalizeLogo),
  );
  // Gallery — same guard as the logo; up to 8 photos, appended one at a time.
  r.post(
    '/:organizationId/gallery/upload-url',
    validate({ params: organizationIdParamSchema, body: galleryUploadUrlBodySchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.requestGalleryUploadUrl),
  );
  r.post(
    '/:organizationId/gallery',
    validate({ params: organizationIdParamSchema, body: finalizeGalleryBodySchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.addGalleryImage),
  );
  r.delete(
    '/:organizationId/gallery',
    validate({ params: organizationIdParamSchema, query: removeGalleryImageQuerySchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.removeGalleryImage),
  );

  r.post(
    '/:organizationId/leave',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    asyncHandler(ctrl.leave),
  );

  // --- engagement: follow + reviews (any authenticated user, not just
  // members — the Clinic Details screen; ACTIVE-only is enforced inside
  // `OrganizationEngagementService`, same rule `discover/:id` uses) ------
  r.post(
    '/:organizationId/follow',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    asyncHandler(ctrl.follow),
  );
  r.delete(
    '/:organizationId/follow',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    asyncHandler(ctrl.unfollow),
  );
  r.post(
    '/:organizationId/reviews',
    validate({ params: organizationIdParamSchema, body: submitReviewBodySchema }),
    withOrganization,
    asyncHandler(ctrl.submitReview),
  );
  r.get(
    '/:organizationId/reviews',
    validate({ params: organizationIdParamSchema, query: listReviewsQuerySchema }),
    withOrganization,
    asyncHandler(ctrl.listReviews),
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
