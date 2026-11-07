import { Router, type RequestHandler } from 'express';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import {
  FEATURED_ORGANIZATION_PERMISSION_KEY,
  HOME_SECTION_PERMISSION_KEY,
} from '../domain/home-section.constants.js';
import { FeaturedOrganizationController } from './featured-organization.controller.js';
import {
  adminFeaturedListQuerySchema,
  featuredCandidatesQuerySchema,
  createFeaturedBodySchema,
  featuredIdParamSchema,
  featuredPlacementQuerySchema,
  updateFeaturedBodySchema,
} from './featured-organization.schemas.js';
import { HomeSectionController } from './home-section.controller.js';
import {
  homeSectionKeyParamSchema,
  homeSectionRegisterImageBodySchema,
  homeSectionUploadUrlBodySchema,
} from './home-section.schemas.js';

/**
 * `GET /home-sections` and `GET /home-sections/featured-organizations?placement=`
 * — any authenticated user (both home pages read them).
 */
export function createPublicHomeSectionRouter(c: Container): Router {
  const ctrl = new HomeSectionController(c.homeSectionImageService);
  const featured = new FeaturedOrganizationController(c.featuredOrganizationService);
  const r = Router();
  r.use(c.authenticate);
  r.get('/', asyncHandler(ctrl.list));
  r.get(
    '/featured-organizations',
    validate({ query: featuredPlacementQuerySchema }),
    asyncHandler(featured.listVisible),
  );
  return r;
}

/**
 * `/admin/home-sections*` — section images: `authorize('home_section.manage')`
 * (held by no base role → ADMIN override only). Featured clinics / offices:
 * `featured_organization.manage` (ADMIN or a FEATURED_CLINICS supervisor) —
 * `home_section.manage` is still accepted there so existing holders keep it.
 * Mounted on its own path (never path-less), so the guards cover only these
 * routes.
 */
export function createAdminHomeSectionRouter(c: Container): Router {
  const ctrl = new HomeSectionController(c.homeSectionImageService);
  const featured = new FeaturedOrganizationController(c.featuredOrganizationService);
  const manage = c.authorization.authorize(HOME_SECTION_PERMISSION_KEY);
  const manageFeatured: RequestHandler = asyncHandler(async (req, _res, next) => {
    const principal = requireAuth(req);
    const authz = c.authorizationService;
    if (
      (await authz.can(principal, FEATURED_ORGANIZATION_PERMISSION_KEY)) ||
      (await authz.can(principal, HOME_SECTION_PERMISSION_KEY))
    ) {
      next();
      return;
    }
    throw new ForbiddenError(
      `Missing required permission: ${FEATURED_ORGANIZATION_PERMISSION_KEY}`,
      { code: ErrorCode.PERMISSION_DENIED },
    );
  });
  const r = Router();
  r.use(c.authenticate);

  r.get('/', manage, asyncHandler(ctrl.list));

  // Featured clinics / offices of the home carousel (before `/:key/...`).
  // Picker for the add form: ACTIVE organizations of the placement's type
  // (id / name / type only — no admin organization read needed).
  r.get(
    '/featured-organizations/candidates',
    manageFeatured,
    validate({ query: featuredCandidatesQuerySchema }),
    asyncHandler(featured.candidates),
  );
  r.get(
    '/featured-organizations',
    manageFeatured,
    validate({ query: adminFeaturedListQuerySchema }),
    asyncHandler(featured.adminList),
  );
  r.post(
    '/featured-organizations',
    manageFeatured,
    validate({ body: createFeaturedBodySchema }),
    asyncHandler(featured.create),
  );
  r.patch(
    '/featured-organizations/:id',
    manageFeatured,
    validate({ params: featuredIdParamSchema, body: updateFeaturedBodySchema }),
    asyncHandler(featured.update),
  );
  r.delete(
    '/featured-organizations/:id',
    manageFeatured,
    validate({ params: featuredIdParamSchema }),
    asyncHandler(featured.remove),
  );
  r.post(
    '/:key/image/upload-url',
    manage,
    validate({ params: homeSectionKeyParamSchema, body: homeSectionUploadUrlBodySchema }),
    asyncHandler(ctrl.requestUploadUrl),
  );
  r.post(
    '/:key/image',
    manage,
    validate({ params: homeSectionKeyParamSchema, body: homeSectionRegisterImageBodySchema }),
    asyncHandler(ctrl.registerImage),
  );
  r.delete(
    '/:key/image',
    manage,
    validate({ params: homeSectionKeyParamSchema }),
    asyncHandler(ctrl.removeImage),
  );
  return r;
}
