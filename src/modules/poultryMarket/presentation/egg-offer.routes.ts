import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { EggOfferController } from './egg-offer.controller.js';
import { createMarketAccessGuards, createMarketMiddleware } from './market.middleware.js';
import {
  createEggOfferBodySchema,
  eggOfferParamSchema,
  rejectEggOfferBodySchema,
  eggOfferUploadUrlBodySchema,
  listAdminEggOffersQuerySchema,
  listEggOffersQuerySchema,
} from './egg-offer.schemas.js';

/**
 * `self`  → `/egg-offers/*`        (Markets & Exchanges access browses — see
 *           `MarketAccessService`; an eligible merchant OR poultry farm
 *           creates/manages their own)
 * `admin` → `/admin/egg-offers/*`  (moderation: view all / delete any)
 */
export function createEggOfferRouters(c: Container): { self: Router; admin: Router } {
  const ctrl = new EggOfferController(
    c.eggOfferService,
    c.authorizationService,
    c.traderRepository,
  );
  const { authorize } = c.authorization;
  const { withEggOffer, requireEggOwnerOrPermission } = createMarketMiddleware({
    poultryOffers: c.poultryOfferRepository,
    eggOffers: c.eggOfferRepository,
    authz: c.authorizationService,
  });

  const { requireMarkets, requireSell } = createMarketAccessGuards(c.marketAccessService);

  const self = Router();
  self.use(c.authenticate);
  self.post(
    '/upload-url',
    requireSell,
    validate({ body: eggOfferUploadUrlBodySchema }),
    asyncHandler(ctrl.requestUploadUrl),
  );
  self.get(
    '/mine',
    requireSell,
    validate({ query: listEggOffersQuerySchema }),
    asyncHandler(ctrl.listMine),
  );
  self.get(
    '/',
    requireMarkets,
    validate({ query: listEggOffersQuerySchema }),
    asyncHandler(ctrl.list),
  );
  self.post(
    '/',
    requireSell,
    validate({ body: createEggOfferBodySchema }),
    asyncHandler(ctrl.create),
  );
  self.get(
    '/:offerId',
    requireMarkets,
    validate({ params: eggOfferParamSchema }),
    withEggOffer,
    asyncHandler(ctrl.getOne),
  );
  self.delete(
    '/:offerId',
    validate({ params: eggOfferParamSchema }),
    withEggOffer,
    requireEggOwnerOrPermission('market.offer.admin.delete'),
    asyncHandler(ctrl.remove),
  );

  const admin = Router();
  admin.use(c.authenticate);
  admin.get(
    '/',
    authorize('market.offer.admin.read'),
    validate({ query: listAdminEggOffersQuerySchema }),
    asyncHandler(ctrl.adminList),
  );
  admin.post(
    '/:offerId/approve',
    authorize('market.offer.admin.moderate'),
    validate({ params: eggOfferParamSchema }),
    withEggOffer,
    asyncHandler(ctrl.approve),
  );
  admin.post(
    '/:offerId/reject',
    authorize('market.offer.admin.moderate'),
    validate({ params: eggOfferParamSchema, body: rejectEggOfferBodySchema }),
    withEggOffer,
    asyncHandler(ctrl.reject),
  );
  admin.delete(
    '/:offerId',
    authorize('market.offer.admin.delete'),
    validate({ params: eggOfferParamSchema }),
    withEggOffer,
    asyncHandler(ctrl.adminRemove),
  );

  return { self, admin };
}
