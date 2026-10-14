import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/http/response.js';
import type { PoultryMarketStatisticsService } from '../application/poultry-market-statistics.service.js';

/** Runs after `requireMarkets` (route) — the access rule lives in `MarketAccessService`. */
export class PoultryMarketStatisticsController {
  constructor(private readonly stats: PoultryMarketStatisticsService) {}

  getSummary = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.stats.getSummary());
  };
}
