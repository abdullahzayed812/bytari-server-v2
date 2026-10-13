import type { Knex } from 'knex';
import { remainingBirdCountSql } from '../../farms/domain/poultry-flock.types.js';

export interface GovernorateStatsRow {
  governorate: string;
  farmCount: number;
  totalBirds: number;
}

/**
 * Read-only aggregate over ACTIVE FARM organizations, grouped by governorate.
 * Backs the "إحصائيات المحافظات" trader benefit / statistics screen.
 *
 * `totalBirds` is the birds STILL in each farm's ACTIVE batches — the batch's
 * starting count minus the deaths recorded in its daily records (the same rule
 * as the batch-summary card). It never uses the count typed at farm
 * registration (`farm_details.current_bird_count`), and closed/sold batches
 * contribute nothing. Mortality is summed per flock and birds per farm BEFORE
 * joining, so neither a flock nor a farm can be counted twice.
 */
export class PoultryMarketStatisticsRepository {
  constructor(private readonly db: Knex) {}

  async byGovernorate(): Promise<GovernorateStatsRow[]> {
    const result: {
      rows: Array<{ governorate: string; farm_count: string; total_birds: string | null }>;
    } = await this.db.raw(`
        WITH flock_mortality AS (
          SELECT poultry_flock_id, SUM(mortality_count) AS mortality
            FROM poultry_daily_records
           GROUP BY poultry_flock_id
        ),
        farm_birds AS (
          SELECT f.organization_id,
                 SUM(${remainingBirdCountSql('f', 'm.mortality')}) AS birds
            FROM poultry_flocks f
            LEFT JOIN flock_mortality m ON m.poultry_flock_id = f.id
           WHERE f.status = 'ACTIVE'
           GROUP BY f.organization_id
        )
        SELECT fd.governorate,
               COUNT(*) AS farm_count,
               COALESCE(SUM(fb.birds), 0) AS total_birds
          FROM organizations o
          JOIN farm_details fd ON fd.organization_id = o.id
          LEFT JOIN farm_birds fb ON fb.organization_id = o.id
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
