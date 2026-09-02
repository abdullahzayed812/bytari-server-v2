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
}
