import type { Logger } from 'pino';
import type {
  GovernorateStatsRow,
  PoultryMarketStatisticsRepository,
} from '../infrastructure/poultry-market-statistics.repository.js';

export interface MarketStatisticsSummary {
  totalFarms: number;
  totalBirds: number;
  byGovernorate: GovernorateStatsRow[];
}

/** Read-only aggregate summary backing the "إحصائيات المحافظات" screen. */
export class PoultryMarketStatisticsService {
  private readonly log: Logger;

  constructor(
    private readonly stats: PoultryMarketStatisticsRepository,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'market-statistics-service' });
  }

  async getSummary(): Promise<MarketStatisticsSummary> {
    const byGovernorate = await this.stats.byGovernorate();
    const totalFarms = byGovernorate.reduce((sum, g) => sum + g.farmCount, 0);
    const totalBirds = byGovernorate.reduce((sum, g) => sum + g.totalBirds, 0);
    return { totalFarms, totalBirds, byGovernorate };
  }
}
