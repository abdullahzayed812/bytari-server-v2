import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { ExchangeRateController } from './exchange-rate.controller.js';
import {
  exchangeRateDateQuerySchema,
  saveEggRatesBodySchema,
  savePoultryRatesBodySchema,
} from './exchange-rate.schemas.js';

/**
 * Mounted at `/market/exchange-rates` — NOT under `/admin`, because an
 * authorized `MARKET` system-supervisor (not just global ADMIN) must be able
 * to reach the save endpoints, and every authenticated user (trader or not)
 * can view the published boards.
 */
export function createExchangeRateRouter(c: Container): Router {
  const ctrl = new ExchangeRateController(c.exchangeRateService);
  const { authorize } = c.authorization;

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/poultry',
    validate({ query: exchangeRateDateQuerySchema }),
    asyncHandler(ctrl.getPoultry),
  );
  r.post(
    '/poultry',
    authorize('market.rate.manage'),
    validate({ body: savePoultryRatesBodySchema }),
    asyncHandler(ctrl.savePoultry),
  );
  r.get('/egg', validate({ query: exchangeRateDateQuerySchema }), asyncHandler(ctrl.getEgg));
  r.post(
    '/egg',
    authorize('market.rate.manage'),
    validate({ body: saveEggRatesBodySchema }),
    asyncHandler(ctrl.saveEgg),
  );

  return r;
}
