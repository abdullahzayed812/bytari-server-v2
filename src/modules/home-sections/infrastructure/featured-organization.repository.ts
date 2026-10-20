import type { Knex } from 'knex';
import {
  FEATURED_TYPES_BY_PLACEMENT,
  rowToFeaturedOrganization,
  type FeaturedOrganization,
  type FeaturedOrganizationRow,
  type FeaturedPlacement,
} from '../domain/featured-organization.types.js';

const T = 'featured_home_organizations';

export interface FeaturedOrganizationWithOrg extends FeaturedOrganization {
  organizationName: string;
  organizationType: string;
  organizationStatus: string;
  subscriptionEndDate: string | null;
}

export class FeaturedOrganizationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /**
   * The subscription end date of a CLINIC / VETERINARY_OFFICE lives in its own
   * details table — both joined, the matching one wins.
   */
  private withOrganization(qb: Knex.QueryBuilder): Knex.QueryBuilder {
    return qb
      .join('organizations as o', 'o.id', 'f.organization_id')
      .leftJoin('clinic_details as cd', 'cd.organization_id', 'o.id')
      .leftJoin('veterinary_office_details as vd', 'vd.organization_id', 'o.id');
  }

  async listForAdmin(
    filter: { placement?: FeaturedPlacement },
    trx?: Knex.Transaction,
  ): Promise<FeaturedOrganizationWithOrg[]> {
    const qb = this.withOrganization(this.conn(trx)(`${T} as f`)).select(
      'f.*',
      'o.name as o_name',
      'o.type as o_type',
      'o.status as o_status',
      this.db.raw(
        'coalesce(cd.subscription_end_date, vd.subscription_end_date) as o_subscription_end',
      ),
    );
    if (filter.placement) void qb.where('f.placement', filter.placement);
    const rows = (await qb
      .orderBy('f.placement')
      .orderBy('f.sort_order')
      .orderBy('f.starts_on')
      .orderBy('f.created_at')) as Array<
      FeaturedOrganizationRow & {
        o_name: string;
        o_type: string;
        o_status: string;
        o_subscription_end: string | null;
      }
    >;
    return rows.map((r) => ({
      ...rowToFeaturedOrganization(r),
      organizationName: r.o_name,
      organizationType: r.o_type,
      organizationStatus: r.o_status,
      subscriptionEndDate: r.o_subscription_end,
    }));
  }

  /**
   * Organization ids to show on `placement` today, in display order: entry
   * switched on, today inside its window, and the organization still publicly
   * visible under the directory rule (ACTIVE, featurable type, subscription not
   * expired — the same rule `discoverWithDetails` applies).
   */
  async listVisibleOrganizationIds(
    placement: FeaturedPlacement,
    today: string,
    limit: number,
    trx?: Knex.Transaction,
  ): Promise<string[]> {
    const rows: Array<{ organization_id: string }> = await this.withOrganization(
      this.conn(trx)(`${T} as f`),
    )
      .where('f.placement', placement)
      .where('f.is_enabled', true)
      .where('f.starts_on', '<=', today)
      .where('f.ends_on', '>=', today)
      .whereIn('o.type', FEATURED_TYPES_BY_PLACEMENT[placement])
      .where('o.status', 'ACTIVE')
      .whereRaw(
        'coalesce(cd.subscription_end_date, vd.subscription_end_date) IS NULL OR coalesce(cd.subscription_end_date, vd.subscription_end_date) >= ?',
        [today],
      )
      .orderBy('f.sort_order')
      .orderBy('f.starts_on')
      .orderBy('f.created_at')
      .limit(limit)
      .select('f.organization_id');
    return rows.map((r) => r.organization_id);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<FeaturedOrganization | null> {
    const row = (await this.conn(trx)(T).where({ id }).first()) as
      FeaturedOrganizationRow | undefined;
    return row ? rowToFeaturedOrganization(row) : null;
  }

  async insert(
    input: {
      organizationId: string;
      placement: FeaturedPlacement;
      startsOn: string;
      endsOn: string;
      isEnabled: boolean;
      sortOrder: number;
      actorUserId: string;
    },
    trx?: Knex.Transaction,
  ): Promise<FeaturedOrganization> {
    const [row] = (await this.conn(trx)(T)
      .insert({
        organization_id: input.organizationId,
        placement: input.placement,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        is_enabled: input.isEnabled,
        sort_order: input.sortOrder,
        created_by_user_id: input.actorUserId,
        updated_by_user_id: input.actorUserId,
      })
      .returning('*')) as FeaturedOrganizationRow[];
    return rowToFeaturedOrganization(row!);
  }

  async update(
    id: string,
    patch: Partial<{
      startsOn: string;
      endsOn: string;
      isEnabled: boolean;
      sortOrder: number;
    }> & { actorUserId: string },
    trx?: Knex.Transaction,
  ): Promise<FeaturedOrganization | null> {
    const db: Record<string, unknown> = {
      updated_by_user_id: patch.actorUserId,
      updated_at: this.db.fn.now(),
    };
    if (patch.startsOn !== undefined) db.starts_on = patch.startsOn;
    if (patch.endsOn !== undefined) db.ends_on = patch.endsOn;
    if (patch.isEnabled !== undefined) db.is_enabled = patch.isEnabled;
    if (patch.sortOrder !== undefined) db.sort_order = patch.sortOrder;
    const [row] = (await this.conn(trx)(T).where({ id }).update(db).returning('*')) as
      FeaturedOrganizationRow[] | [];
    return row ? rowToFeaturedOrganization(row) : null;
  }

  async delete(id: string, trx?: Knex.Transaction): Promise<boolean> {
    return (await this.conn(trx)(T).where({ id }).delete()) > 0;
  }
}
