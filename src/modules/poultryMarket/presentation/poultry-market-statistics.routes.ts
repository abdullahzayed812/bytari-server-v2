import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import type { Container } from '../../../container.js';
import { createMarketAccessGuards } from './market.middleware.js';
import { PoultryMarketStatisticsController } from './poultry-market-statistics.controller.js';

/** Mounted at `/poultry-market/statistics` — Markets & Exchanges access (merchant / poultry farm / staff). */
export function createPoultryMarketStatisticsRouter(c: Container): Router {
  const ctrl = new PoultryMarketStatisticsController(c.poultryMarketStatisticsService);
  const { requireMarkets } = createMarketAccessGuards(c.marketAccessService);

  const r = Router();
  r.use(c.authenticate);
  r.get('/', requireMarkets, asyncHandler(ctrl.getSummary));

  return r;
}
