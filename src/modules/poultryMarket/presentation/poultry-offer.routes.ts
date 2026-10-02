import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { PoultryOfferController } from './poultry-offer.controller.js';
import { createMarketMiddleware, createTraderSubscriptionGuard } from './market.middleware.js';
import {
  createPoultryOfferBodySchema,
  listAdminPoultryOffersQuerySchema,
  listPoultryOffersQuerySchema,
  poultryOfferParamSchema,
  rejectPoultryOfferBodySchema,
  poultryOfferUploadUrlBodySchema,
} from './poultry-offer.schemas.js';

/**
 * `self`  → `/poultry-offers/*`        (any authenticated user browses; an
 *           APPROVED trader creates/manages their own)
 * `admin` → `/admin/poultry-offers/*`  (moderation: view all / delete any)
 *
 * `/mine` is registered BEFORE `/:offerId` — same ordering rule as the
 * existing `/users/me` vs `/users/:id` split (otherwise "mine" would be
 * parsed as a `:offerId` uuid param and rejected).
 */
export function createPoultryOfferRouters(c: Container): { self: Router; admin: Router } {
  const ctrl = new PoultryOfferController(
    c.poultryOfferService,
    c.authorizationService,
    c.traderRepository,
  );
  const { authorize, requireApprovedTrader } = c.authorization;
  const { withPoultryOffer, requireOwnerOrPermission } = createMarketMiddleware({
    poultryOffers: c.poultryOfferRepository,
    eggOffers: c.eggOfferRepository,
    authz: c.authorizationService,
  });

  const activeTrader = createTraderSubscriptionGuard({
    traders: c.traderRepository,
    authz: c.authorizationService,
  });

  const self = Router();
  self.use(c.authenticate);
  self.post(
    '/upload-url',
    requireApprovedTrader(),
    activeTrader,
    validate({ body: poultryOfferUploadUrlBodySchema }),
    asyncHandler(ctrl.requestUploadUrl),
  );
  self.get(
    '/mine',
    requireApprovedTrader(),
    activeTrader,
    validate({ query: listPoultryOffersQuerySchema }),
    asyncHandler(ctrl.listMine),
  );
  self.get('/', validate({ query: listPoultryOffersQuerySchema }), asyncHandler(ctrl.list));
  self.post(
    '/',
    requireApprovedTrader(),
    activeTrader,
    validate({ body: createPoultryOfferBodySchema }),
    asyncHandler(ctrl.create),
  );
  self.get(
    '/:offerId',
    validate({ params: poultryOfferParamSchema }),
    withPoultryOffer,
    asyncHandler(ctrl.getOne),
  );
  self.delete(
    '/:offerId',
    validate({ params: poultryOfferParamSchema }),
    withPoultryOffer,
    requireOwnerOrPermission('market.offer.admin.delete'),
    asyncHandler(ctrl.remove),
  );

  const admin = Router();
  admin.use(c.authenticate);
  admin.get(
    '/',
    authorize('market.offer.admin.read'),
    validate({ query: listAdminPoultryOffersQuerySchema }),
    asyncHandler(ctrl.adminList),
  );
  admin.post(
    '/:offerId/approve',
    authorize('market.offer.admin.moderate'),
    validate({ params: poultryOfferParamSchema }),
    withPoultryOffer,
    asyncHandler(ctrl.approve),
  );
  admin.post(
    '/:offerId/reject',
    authorize('market.offer.admin.moderate'),
    validate({ params: poultryOfferParamSchema, body: rejectPoultryOfferBodySchema }),
    withPoultryOffer,
    asyncHandler(ctrl.reject),
  );
  admin.delete(
    '/:offerId',
    authorize('market.offer.admin.delete'),
    validate({ params: poultryOfferParamSchema }),
    withPoultryOffer,
    asyncHandler(ctrl.adminRemove),
  );

  return { self, admin };
}
