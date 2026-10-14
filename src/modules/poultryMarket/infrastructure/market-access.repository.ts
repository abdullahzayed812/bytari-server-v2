import type { Knex } from 'knex';

/** A poultry farm species — `farm_species` POULTRY / MIXED, or legacy null. Never SHEEP / CATTLE. */
function wherePoultrySpecies(qb: Knex.QueryBuilder): void {
  void qb.where((b) => {
    void b.whereNull('d.farm_species').orWhereIn('d.farm_species', ['POULTRY', 'MIXED']);
  });
}

/**
 * Users who OWN at least one market-eligible poultry farm right now: ACTIVE,
 * poultry, subscription dates set and `end >= today`. A sub-query (never
 * materialized) so the offer browse filters can use it inline.
 */
export function eligibleFarmOwnerIdsQuery(conn: Knex | Knex.Transaction): Knex.QueryBuilder {
  const qb = conn('organizations as o')
    .join('farm_details as d', 'd.organization_id', 'o.id')
    .where('o.type', 'FARM')
    .andWhere('o.status', 'ACTIVE')
    .whereNotNull('d.subscription_start_date')
    .whereNotNull('d.subscription_end_date')
    .andWhereRaw('d.subscription_end_date >= CURRENT_DATE')
    .select('o.owner_user_id');
  wherePoultrySpecies(qb);
  return qb;
}

/**
 * Sellers whose offers stay on the public market: an eligible poultry-farm
 * owner, or a trader whose activation period has not ended (same rule as
 * before — a trader with no dates yet is not hidden).
 */
export function whereVisibleMarketSeller(
  qb: Knex.QueryBuilder,
  conn: Knex | Knex.Transaction,
  column = 'trader_user_id',
): void {
  void qb.where((v) => {
    void v.whereIn(column, eligibleFarmOwnerIdsQuery(conn)).orWhereIn(
      column,
      conn('trader_profiles')
        .where((t) => {
          void t
            .whereNull('subscription_end_date')
            .orWhereRaw('subscription_end_date >= CURRENT_DATE');
        })
        .select('user_id'),
    );
  });
}

export interface OwnedPoultryFarmRow {
  organizationId: string;
  name: string;
  status: string;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
}

function dateOnly(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v.slice(0, 10);
}

export class MarketAccessRepository {
  constructor(private readonly db: Knex) {}

  /**
   * Every poultry farm the user OWNS (ownership from `organizations.owner_user_id`,
   * never a client-sent id), except admin-deleted (DEACTIVATED) ones — the
   * caller evaluates each farm's eligibility independently.
   */
  async listOwnedPoultryFarms(userId: string): Promise<OwnedPoultryFarmRow[]> {
    const qb = this.db('organizations as o')
      .join('farm_details as d', 'd.organization_id', 'o.id')
      .where('o.type', 'FARM')
      .andWhere('o.owner_user_id', userId)
      .whereNot('o.status', 'DEACTIVATED')
      .orderBy('o.created_at', 'asc')
      .select<
        Array<{
          id: string;
          name: string;
          status: string;
          subscription_start_date: string | Date | null;
          subscription_end_date: string | Date | null;
        }>
      >('o.id', 'o.name', 'o.status', 'd.subscription_start_date', 'd.subscription_end_date');
    wherePoultrySpecies(qb);
    const rows = await qb;
    return rows.map((r) => ({
      organizationId: r.id,
      name: r.name,
      status: r.status,
      subscriptionStartDate: dateOnly(r.subscription_start_date),
      subscriptionEndDate: dateOnly(r.subscription_end_date),
    }));
  }
}
