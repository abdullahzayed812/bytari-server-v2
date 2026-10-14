import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { ExchangeRateController } from './exchange-rate.controller.js';
import { createMarketAccessGuards } from './market.middleware.js';
import {
  exchangeRateDateQuerySchema,
  saveEggRatesBodySchema,
  savePoultryRatesBodySchema,
} from './exchange-rate.schemas.js';

/**
 * Mounted at `/market/exchange-rates` — NOT under `/admin`, because an
 * authorized `MARKET` system-supervisor (not just global ADMIN) must be able
 * to reach the save endpoints. Viewing the published boards needs Markets &
 * Exchanges access (an eligible merchant / poultry farm, or MARKET staff).
 */
export function createExchangeRateRouter(c: Container): Router {
  const ctrl = new ExchangeRateController(c.exchangeRateService);
  const { authorize } = c.authorization;
  const { requireMarkets } = createMarketAccessGuards(c.marketAccessService);

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/poultry',
    requireMarkets,
    validate({ query: exchangeRateDateQuerySchema }),
    asyncHandler(ctrl.getPoultry),
  );
  r.post(
    '/poultry',
    authorize('market.rate.manage'),
    validate({ body: savePoultryRatesBodySchema }),
    asyncHandler(ctrl.savePoultry),
  );
  r.get(
    '/egg',
    requireMarkets,
    validate({ query: exchangeRateDateQuerySchema }),
    asyncHandler(ctrl.getEgg),
  );
  r.post(
    '/egg',
    authorize('market.rate.manage'),
    validate({ body: saveEggRatesBodySchema }),
    asyncHandler(ctrl.saveEgg),
  );

  return r;
}
