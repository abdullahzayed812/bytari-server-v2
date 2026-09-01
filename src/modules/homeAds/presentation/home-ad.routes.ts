import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { HOME_AD_PERMISSION_KEY } from '../domain/home-ad.constants.js';
import { HomeAdController } from './home-ad.controller.js';
import {
  createHomeAdBodySchema,
  homeAdIdParamSchema,
  listAdminHomeAdsQuerySchema,
  registerImageBodySchema,
  updateHomeAdBodySchema,
  uploadUrlBodySchema,
} from './home-ad.schemas.js';

/** `GET /home-ads` — any authenticated user (the Pet Owner Home carousel). */
export function createHomeAdRouter(c: Container): Router {
  const ctrl = new HomeAdController(c.homeAdService);
  const r = Router();
  r.use(c.authenticate);
  r.get('/', asyncHandler(ctrl.listPublic));
  return r;
}

/**
 * `/admin/home-ads*` — `authenticate → authorize('home_ad.manage') → controller`.
 * `authorize` = ADMIN override or an ACTIVE HOME_AD system-supervisor
 * assignment (`SUPERVISOR_DOMAIN_PERMISSIONS.HOME_AD`).
 */
export function createAdminHomeAdRouter(c: Container): Router {
  const ctrl = new HomeAdController(c.homeAdService);
  const { authorize } = c.authorization;
  const manage = authorize(HOME_AD_PERMISSION_KEY);

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/',
    manage,
    validate({ query: listAdminHomeAdsQuerySchema }),
    asyncHandler(ctrl.listAdmin),
  );
  r.post('/', manage, validate({ body: createHomeAdBodySchema }), asyncHandler(ctrl.create));
  r.get(
    '/:homeAdId',
    manage,
    validate({ params: homeAdIdParamSchema }),
    asyncHandler(ctrl.getAdmin),
  );
  r.patch(
    '/:homeAdId',
    manage,
    validate({ params: homeAdIdParamSchema, body: updateHomeAdBodySchema }),
    asyncHandler(ctrl.update),
  );
  r.delete(
    '/:homeAdId',
    manage,
    validate({ params: homeAdIdParamSchema }),
    asyncHandler(ctrl.remove),
  );
  r.post(
    '/:homeAdId/restore',
    manage,
    validate({ params: homeAdIdParamSchema }),
    asyncHandler(ctrl.restore),
  );
  r.post(
    '/:homeAdId/activate',
    manage,
    validate({ params: homeAdIdParamSchema }),
    asyncHandler(ctrl.activate),
  );
  r.post(
    '/:homeAdId/deactivate',
    manage,
    validate({ params: homeAdIdParamSchema }),
    asyncHandler(ctrl.deactivate),
  );
  r.post(
    '/:homeAdId/image/upload-url',
    manage,
    validate({ params: homeAdIdParamSchema, body: uploadUrlBodySchema }),
    asyncHandler(ctrl.requestUploadUrl),
  );
  r.post(
    '/:homeAdId/image',
    manage,
    validate({ params: homeAdIdParamSchema, body: registerImageBodySchema }),
    asyncHandler(ctrl.registerImage),
  );

  return r;
}
