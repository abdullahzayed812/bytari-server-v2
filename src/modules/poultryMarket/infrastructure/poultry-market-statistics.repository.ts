import type { Knex } from 'knex';

export interface GovernorateStatsRow {
  governorate: string;
  farmCount: number;
  totalBirds: number;
}

/**
 * Read-only aggregate over ACTIVE FARM organizations, grouped by governorate.
 * Backs the "إحصائيات المحافظات" trader benefit / statistics screen.
 */
export class PoultryMarketStatisticsRepository {
  constructor(private readonly db: Knex) {}

  async byGovernorate(): Promise<GovernorateStatsRow[]> {
    const result: { rows: Array<{ governorate: string; farm_count: string; total_birds: string | null }> } =
      await this.db.raw(`
        SELECT fd.governorate, COUNT(*) as farm_count, SUM(fd.current_bird_count) as total_birds
          FROM organizations o
          JOIN farm_details fd ON fd.organization_id = o.id
         WHERE o.type = 'FARM' AND o.status = 'ACTIVE' AND fd.governorate IS NOT NULL
         GROUP BY fd.governorate
         ORDER BY fd.governorate ASC
      `);
    const rows = result.rows;

    return rows.map((r) => ({
      governorate: r.governorate,
      farmCount: Number(r.farm_count),
      totalBirds: Number(r.total_birds ?? 0),
    }));
  }
}
