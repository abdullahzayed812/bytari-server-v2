import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { HOME_SECTION_PERMISSION_KEY } from '../domain/home-section.constants.js';
import { FeaturedOrganizationController } from './featured-organization.controller.js';
import {
  adminFeaturedListQuerySchema,
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
 * `/admin/home-sections*` — `authenticate → authorize('home_section.manage')`.
 * Mounted on its own path (never path-less), so the guard covers only these
 * routes. `home_section.manage` is held by no base role → ADMIN override only.
 */
export function createAdminHomeSectionRouter(c: Container): Router {
  const ctrl = new HomeSectionController(c.homeSectionImageService);
  const featured = new FeaturedOrganizationController(c.featuredOrganizationService);
  const manage = c.authorization.authorize(HOME_SECTION_PERMISSION_KEY);
  const r = Router();
  r.use(c.authenticate);

  r.get('/', manage, asyncHandler(ctrl.list));

  // Featured clinics / offices of the home carousel (before `/:key/...`).
  r.get(
    '/featured-organizations',
    manage,
    validate({ query: adminFeaturedListQuerySchema }),
    asyncHandler(featured.adminList),
  );
  r.post(
    '/featured-organizations',
    manage,
    validate({ body: createFeaturedBodySchema }),
    asyncHandler(featured.create),
  );
  r.patch(
    '/featured-organizations/:id',
    manage,
    validate({ params: featuredIdParamSchema, body: updateFeaturedBodySchema }),
    asyncHandler(featured.update),
  );
  r.delete(
    '/featured-organizations/:id',
    manage,
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
