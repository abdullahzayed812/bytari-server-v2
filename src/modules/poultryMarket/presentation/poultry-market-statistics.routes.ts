import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import type { Container } from '../../../container.js';
import { PoultryMarketStatisticsController } from './poultry-market-statistics.controller.js';

/** Mounted at `/market/statistics` — admin or approved-trader only (checked in the controller). */
export function createPoultryMarketStatisticsRouter(c: Container): Router {
  const ctrl = new PoultryMarketStatisticsController(c.poultryMarketStatisticsService, c.authorizationService);

  const r = Router();
  r.use(c.authenticate);
  r.get('/', asyncHandler(ctrl.getSummary));

  return r;
}
