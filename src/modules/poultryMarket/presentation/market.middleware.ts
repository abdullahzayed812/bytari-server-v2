import type { Request, RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { PoultryOfferRepository } from '../infrastructure/poultry-offer.repository.js';
import type { EggOfferRepository } from '../infrastructure/egg-offer.repository.js';

/** Narrow `req.poultryOffer` inside a controller that runs after `withPoultryOffer`. */
export function requirePoultryOffer(req: Request): Express.PoultryOfferContext {
  if (!req.poultryOffer) throw new NotFoundError('Offer not found');
  return req.poultryOffer;
}

/** Narrow `req.eggOffer` inside a controller that runs after `withEggOffer`. */
export function requireEggOffer(req: Request): Express.EggOfferContext {
  if (!req.eggOffer) throw new NotFoundError('Offer not found');
  return req.eggOffer;
}

export function createMarketMiddleware(deps: {
  poultryOffers: PoultryOfferRepository;
  eggOffers: EggOfferRepository;
  authz: AuthorizationService;
}): {
  withPoultryOffer: RequestHandler;
  withEggOffer: RequestHandler;
  requireOwnerOrPermission: (permission: string) => RequestHandler;
  requireEggOwnerOrPermission: (permission: string) => RequestHandler;
} {
  const withPoultryOffer: RequestHandler = asyncHandler(async (req, _res, next) => {
    const { offerId } = validatedParams<{ offerId: string }>(req);
    const offer = await deps.poultryOffers.findById(offerId);
    if (!offer) throw new NotFoundError('Offer not found');
    req.poultryOffer = { id: offer.id, status: offer.status, traderUserId: offer.traderUserId };
    next();
  });

  const withEggOffer: RequestHandler = asyncHandler(async (req, _res, next) => {
    const { offerId } = validatedParams<{ offerId: string }>(req);
    const offer = await deps.eggOffers.findById(offerId);
    if (!offer) throw new NotFoundError('Offer not found');
    req.eggOffer = { id: offer.id, status: offer.status, traderUserId: offer.traderUserId };
    next();
  });

  /** MUST run after `withPoultryOffer`. The offer's own trader, or `permission` (ADMIN/MARKET-supervisor). */
  const requireOwnerOrPermission = (permission: string): RequestHandler =>
    asyncHandler(async (req, _res, next) => {
      const auth = requireAuth(req);
      const offer = requirePoultryOffer(req);
      if (offer.traderUserId === auth.userId) return next();
      await deps.authz.assert(auth, permission);
      next();
    });

  /** MUST run after `withEggOffer`. The offer's own trader, or `permission` (ADMIN/MARKET-supervisor). */
  const requireEggOwnerOrPermission = (permission: string): RequestHandler =>
    asyncHandler(async (req, _res, next) => {
      const auth = requireAuth(req);
      const offer = requireEggOffer(req);
      if (offer.traderUserId === auth.userId) return next();
      await deps.authz.assert(auth, permission);
      next();
    });

  return { withPoultryOffer, withEggOffer, requireOwnerOrPermission, requireEggOwnerOrPermission };
}
