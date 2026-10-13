import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { HOME_SECTION_PERMISSION_KEY } from '../domain/home-section.constants.js';
import { HomeSectionController } from './home-section.controller.js';
import {
  homeSectionKeyParamSchema,
  homeSectionRegisterImageBodySchema,
  homeSectionUploadUrlBodySchema,
} from './home-section.schemas.js';

/** `GET /home-sections` — any authenticated user (both home pages read it). */
export function createPublicHomeSectionRouter(c: Container): Router {
  const ctrl = new HomeSectionController(c.homeSectionImageService);
  const r = Router();
  r.use(c.authenticate);
  r.get('/', asyncHandler(ctrl.list));
  return r;
}

/**
 * `/admin/home-sections*` — `authenticate → authorize('home_section.manage')`.
 * Mounted on its own path (never path-less), so the guard covers only these
 * routes. `home_section.manage` is held by no base role → ADMIN override only.
 */
export function createAdminHomeSectionRouter(c: Container): Router {
  const ctrl = new HomeSectionController(c.homeSectionImageService);
  const manage = c.authorization.authorize(HOME_SECTION_PERMISSION_KEY);
  const r = Router();
  r.use(c.authenticate);

  r.get('/', manage, asyncHandler(ctrl.list));
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
