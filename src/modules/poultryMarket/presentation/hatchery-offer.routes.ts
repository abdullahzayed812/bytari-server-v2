import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { HatcheryOfferController } from './hatchery-offer.controller.js';
import { createMarketAccessGuards, createMarketMiddleware } from './market.middleware.js';
import {
  createHatcheryOfferBodySchema,
  hatcheryOfferParamSchema,
  rejectHatcheryOfferBodySchema,
  hatcheryOfferUploadUrlBodySchema,
  listAdminHatcheryOffersQuerySchema,
  listHatcheryOffersQuerySchema,
} from './hatchery-offer.schemas.js';

/**
 * Hatchery offers ("عروض المفاقس") — same access + moderation as egg offers.
 * `self`  → `/hatchery-offers/*`        (Markets & Exchanges access browses — see
 *           `MarketAccessService`; an eligible merchant OR poultry farm
 *           creates/manages their own)
 * `admin` → `/admin/hatchery-offers/*`  (moderation: view all / delete any)
 */
export function createHatcheryOfferRouters(c: Container): { self: Router; admin: Router } {
  const ctrl = new HatcheryOfferController(
    c.hatcheryOfferService,
    c.authorizationService,
    c.traderRepository,
  );
  const { authorize } = c.authorization;
  const { withHatcheryOffer, requireHatcheryOwnerOrPermission } = createMarketMiddleware({
    poultryOffers: c.poultryOfferRepository,
    eggOffers: c.eggOfferRepository,
    hatcheryOffers: c.hatcheryOfferRepository,
    authz: c.authorizationService,
  });

  const { requireMarkets, requireSell } = createMarketAccessGuards(c.marketAccessService);

  const self = Router();
  self.use(c.authenticate);
  self.post(
    '/upload-url',
    requireSell,
    validate({ body: hatcheryOfferUploadUrlBodySchema }),
    asyncHandler(ctrl.requestUploadUrl),
  );
  self.get(
    '/mine',
    requireSell,
    validate({ query: listHatcheryOffersQuerySchema }),
    asyncHandler(ctrl.listMine),
  );
  self.get(
    '/',
    requireMarkets,
    validate({ query: listHatcheryOffersQuerySchema }),
    asyncHandler(ctrl.list),
  );
  self.post(
    '/',
    requireSell,
    validate({ body: createHatcheryOfferBodySchema }),
    asyncHandler(ctrl.create),
  );
  self.get(
    '/:offerId',
    requireMarkets,
    validate({ params: hatcheryOfferParamSchema }),
    withHatcheryOffer,
    asyncHandler(ctrl.getOne),
  );
  self.delete(
    '/:offerId',
    validate({ params: hatcheryOfferParamSchema }),
    withHatcheryOffer,
    requireHatcheryOwnerOrPermission('market.offer.admin.delete'),
    asyncHandler(ctrl.remove),
  );

  const admin = Router();
  admin.use(c.authenticate);
  admin.get(
    '/',
    authorize('market.offer.admin.read'),
    validate({ query: listAdminHatcheryOffersQuerySchema }),
    asyncHandler(ctrl.adminList),
  );
  admin.post(
    '/:offerId/approve',
    authorize('market.offer.admin.moderate'),
    validate({ params: hatcheryOfferParamSchema }),
    withHatcheryOffer,
    asyncHandler(ctrl.approve),
  );
  admin.post(
    '/:offerId/reject',
    authorize('market.offer.admin.moderate'),
    validate({ params: hatcheryOfferParamSchema, body: rejectHatcheryOfferBodySchema }),
    withHatcheryOffer,
    asyncHandler(ctrl.reject),
  );
  admin.delete(
    '/:offerId',
    authorize('market.offer.admin.delete'),
    validate({ params: hatcheryOfferParamSchema }),
    withHatcheryOffer,
    asyncHandler(ctrl.adminRemove),
  );

  return { self, admin };
}
