import type { Knex } from 'knex';
import {
  rowToOrganizationReview,
  type OrganizationReview,
  type OrganizationReviewRow,
  type OrganizationReviewWithAuthor,
} from '../domain/organization.types.js';

const TABLE = 'organization_reviews';

export interface ReviewAggregate {
  /** `null` when there are no reviews yet. */
  average: number | null;
  count: number;
}

/** One rating (1-5) + optional comment per (organization, user) — upsert on resubmit. */
export class OrganizationReviewRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async upsert(
    organizationId: string,
    userId: string,
    data: { rating: number; comment: string | null },
    trx?: Knex.Transaction,
  ): Promise<OrganizationReview> {
    const [row] = (await this.conn(trx)(TABLE)
      .insert({
        organization_id: organizationId,
        user_id: userId,
        rating: data.rating,
        comment: data.comment,
      })
      .onConflict(['organization_id', 'user_id'])
      .merge({ rating: data.rating, comment: data.comment, updated_at: new Date() })
      .returning('*')) as OrganizationReviewRow[];
    if (!row) throw new Error('organization review upsert did not return a row');
    return rowToOrganizationReview(row);
  }

  async findOwn(
    organizationId: string,
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationReview | null> {
    const row = await this.conn(trx)<OrganizationReviewRow>(TABLE)
      .where({ organization_id: organizationId, user_id: userId })
      .first();
    return row ? rowToOrganizationReview(row) : null;
  }

  async aggregate(organizationId: string, trx?: Knex.Transaction): Promise<ReviewAggregate> {
    const row = await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId })
      .avg<{ avg: string | null }>({ avg: 'rating' })
      .count<{ count: string }>({ count: '*' })
      .first();
    const count = Number(row?.count ?? 0);
    const average = row?.avg == null ? null : Math.round(Number(row.avg) * 10) / 10;
    return { average: count > 0 ? average : null, count };
  }

  /**
   * Batched counterpart of {@link aggregate} for a page of organizations (the
   * discover list) — one grouped query instead of one per row. Organizations
   * with no reviews simply have no entry in the returned map.
   */
  async aggregateMany(
    organizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, ReviewAggregate>> {
    const result = new Map<string, ReviewAggregate>();
    if (organizationIds.length === 0) return result;

    const rows: { organization_id: string; avg: string | null; count: string }[] = await this.conn(
      trx,
    )(TABLE)
      .whereIn('organization_id', organizationIds)
      .groupBy('organization_id')
      .select(
        'organization_id',
        this.conn(trx).raw('avg(rating) as avg'),
        this.conn(trx).raw('count(*) as count'),
      );

    for (const row of rows) {
      const count = Number(row.count);
      const average = row.avg == null ? null : Math.round(Number(row.avg) * 10) / 10;
      result.set(row.organization_id, { average: count > 0 ? average : null, count });
    }
    return result;
  }

  async listForOrg(
    organizationId: string,
    page: number,
    pageSize: number,
    trx?: Knex.Transaction,
  ): Promise<{ items: OrganizationReviewWithAuthor[]; total: number }> {
    const conn = this.conn(trx);
    const countRow = await conn(TABLE)
      .where({ organization_id: organizationId })
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = await conn(`${TABLE} as rv`)
      .join('users as u', 'u.id', 'rv.user_id')
      .where('rv.organization_id', organizationId)
      .orderBy('rv.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .select('rv.*', 'u.first_name as u_first_name', 'u.last_name as u_last_name');

    const items = rows.map((row) => ({
      ...rowToOrganizationReview(row),
      author: { firstName: row.u_first_name, lastName: row.u_last_name },
    }));
    return { items, total };
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<OrganizationReview | null> {
    const row = await this.conn(trx)<OrganizationReviewRow>(TABLE).where({ id }).first();
    return row ? rowToOrganizationReview(row) : null;
  }

  async deleteById(id: string, trx?: Knex.Transaction): Promise<boolean> {
    const n = await this.conn(trx)(TABLE).where({ id }).delete();
    return Number(n) > 0;
  }

  /**
   * Admin moderation list — every review across organizations, newest first,
   * with the organization (name/type) and the author so the moderator sees
   * where each review belongs. Optional narrowing by organization / type.
   */
  async listForModeration(
    filter: {
      page: number;
      pageSize: number;
      organizationId?: string;
      organizationType?: string;
      maxRating?: number;
    },
    trx?: Knex.Transaction,
  ): Promise<{ items: AdminOrganizationReview[]; total: number }> {
    const conn = this.conn(trx);
    const base = (): Knex.QueryBuilder => {
      const qb = conn(`${TABLE} as rv`).join('organizations as o', 'o.id', 'rv.organization_id');
      if (filter.organizationId) qb.where('rv.organization_id', filter.organizationId);
      if (filter.organizationType) qb.where('o.type', filter.organizationType);
      if (filter.maxRating !== undefined) qb.where('rv.rating', '<=', filter.maxRating);
      return qb;
    };
    const countRow = (await base().count({ count: '*' }).first()) as { count: string } | undefined;
    const total = Number(countRow?.count ?? 0);

    type ModerationRow = OrganizationReviewRow & {
      u_first_name: string;
      u_last_name: string;
      u_email: string;
      o_name: string;
      o_type: string;
    };
    const rows: ModerationRow[] = await base()
      .join('users as u', 'u.id', 'rv.user_id')
      .orderBy('rv.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select(
        'rv.*',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
        'u.email as u_email',
        'o.name as o_name',
        'o.type as o_type',
      );

    return {
      items: rows.map((row) => ({
        ...rowToOrganizationReview(row),
        author: { firstName: row.u_first_name, lastName: row.u_last_name, email: row.u_email },
        organization: { id: row.organization_id, name: row.o_name, type: row.o_type },
      })),
      total,
    };
  }
}

export interface AdminOrganizationReview extends OrganizationReview {
  author: { firstName: string; lastName: string; email: string };
  organization: { id: string; name: string; type: string };
}
