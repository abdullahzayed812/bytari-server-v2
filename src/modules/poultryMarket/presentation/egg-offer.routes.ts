import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { EggOfferController } from './egg-offer.controller.js';
import { createMarketMiddleware } from './market.middleware.js';
import {
  createEggOfferBodySchema,
  eggOfferParamSchema,
  eggOfferUploadUrlBodySchema,
  listAdminEggOffersQuerySchema,
  listEggOffersQuerySchema,
} from './egg-offer.schemas.js';

/**
 * `self`  → `/egg-offers/*`        (any authenticated user browses; an
 *           APPROVED trader creates/manages their own)
 * `admin` → `/admin/egg-offers/*`  (moderation: view all / delete any)
 */
export function createEggOfferRouters(c: Container): { self: Router; admin: Router } {
  const ctrl = new EggOfferController(c.eggOfferService);
  const { authorize, requireApprovedTrader } = c.authorization;
  const { withEggOffer, requireEggOwnerOrPermission } = createMarketMiddleware({
    poultryOffers: c.poultryOfferRepository,
    eggOffers: c.eggOfferRepository,
    authz: c.authorizationService,
  });

  const self = Router();
  self.use(c.authenticate);
  self.post(
    '/upload-url',
    requireApprovedTrader(),
    validate({ body: eggOfferUploadUrlBodySchema }),
    asyncHandler(ctrl.requestUploadUrl),
  );
  self.get(
    '/mine',
    requireApprovedTrader(),
    validate({ query: listEggOffersQuerySchema }),
    asyncHandler(ctrl.listMine),
  );
  self.get('/', validate({ query: listEggOffersQuerySchema }), asyncHandler(ctrl.list));
  self.post(
    '/',
    requireApprovedTrader(),
    validate({ body: createEggOfferBodySchema }),
    asyncHandler(ctrl.create),
  );
  self.get(
    '/:offerId',
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
  admin.delete(
    '/:offerId',
    authorize('market.offer.admin.delete'),
    validate({ params: eggOfferParamSchema }),
    withEggOffer,
    asyncHandler(ctrl.adminRemove),
  );

  return { self, admin };
}
