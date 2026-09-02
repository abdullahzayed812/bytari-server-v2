import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { ADVERTISEMENT_PERMISSION_KEY } from '../domain/advertisement.constants.js';
import { AdvertisementController } from './advertisement.controller.js';
import {
  campaignIdParamSchema,
  createCampaignBodySchema,
  createSlideBodySchema,
  listAdminCampaignsQuerySchema,
  listPublicAdsQuerySchema,
  registerImageBodySchema,
  reorderSlidesBodySchema,
  slideParamsSchema,
  updateCampaignBodySchema,
  updateSlideBodySchema,
  uploadUrlBodySchema,
} from './advertisement.schemas.js';

/** `GET /ads?placement=…` — any authenticated user (the in-app advertisement feed). */
export function createPublicAdRouter(c: Container): Router {
  const ctrl = new AdvertisementController(c.advertisementService);
  const r = Router();
  r.use(c.authenticate);
  r.get('/', validate({ query: listPublicAdsQuerySchema }), asyncHandler(ctrl.listPublic));
  return r;
}

/**
 * `/admin/ads*` — `authenticate → authorize('advertisement.manage') → controller`.
 * `authorize` = ADMIN override or an ACTIVE ADVERTISEMENT system-supervisor
 * assignment (`SUPERVISOR_DOMAIN_PERMISSIONS.ADVERTISEMENT`). One permission
 * governs every placement.
 */
export function createAdminAdRouter(c: Container): Router {
  const ctrl = new AdvertisementController(c.advertisementService);
  const { authorize } = c.authorization;
  const manage = authorize(ADVERTISEMENT_PERMISSION_KEY);

  const r = Router();
  r.use(c.authenticate);

  // --- campaigns ---
  r.get(
    '/',
    manage,
    validate({ query: listAdminCampaignsQuerySchema }),
    asyncHandler(ctrl.listAdmin),
  );
  r.post(
    '/',
    manage,
    validate({ body: createCampaignBodySchema }),
    asyncHandler(ctrl.createCampaign),
  );
  r.get(
    '/:campaignId',
    manage,
    validate({ params: campaignIdParamSchema }),
    asyncHandler(ctrl.getAdmin),
  );
  r.patch(
    '/:campaignId',
    manage,
    validate({ params: campaignIdParamSchema, body: updateCampaignBodySchema }),
    asyncHandler(ctrl.updateCampaign),
  );
  r.delete(
    '/:campaignId',
    manage,
    validate({ params: campaignIdParamSchema }),
    asyncHandler(ctrl.removeCampaign),
  );
  r.post(
    '/:campaignId/restore',
    manage,
    validate({ params: campaignIdParamSchema }),
    asyncHandler(ctrl.restoreCampaign),
  );
  r.post(
    '/:campaignId/activate',
    manage,
    validate({ params: campaignIdParamSchema }),
    asyncHandler(ctrl.activateCampaign),
  );
  r.post(
    '/:campaignId/deactivate',
    manage,
    validate({ params: campaignIdParamSchema }),
    asyncHandler(ctrl.deactivateCampaign),
  );

  // --- slides ---
  r.post(
    '/:campaignId/slides',
    manage,
    validate({ params: campaignIdParamSchema, body: createSlideBodySchema }),
    asyncHandler(ctrl.addSlide),
  );
  r.post(
    '/:campaignId/slides/reorder',
    manage,
    validate({ params: campaignIdParamSchema, body: reorderSlidesBodySchema }),
    asyncHandler(ctrl.reorderSlides),
  );
  r.patch(
    '/:campaignId/slides/:slideId',
    manage,
    validate({ params: slideParamsSchema, body: updateSlideBodySchema }),
    asyncHandler(ctrl.updateSlide),
  );
  r.delete(
    '/:campaignId/slides/:slideId',
    manage,
    validate({ params: slideParamsSchema }),
    asyncHandler(ctrl.removeSlide),
  );
  r.post(
    '/:campaignId/slides/:slideId/image/upload-url',
    manage,
    validate({ params: slideParamsSchema, body: uploadUrlBodySchema }),
    asyncHandler(ctrl.requestSlideUploadUrl),
  );
  r.post(
    '/:campaignId/slides/:slideId/image',
    manage,
    validate({ params: slideParamsSchema, body: registerImageBodySchema }),
    asyncHandler(ctrl.registerSlideImage),
  );

  return r;
}
