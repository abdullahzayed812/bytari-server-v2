import type { Knex } from 'knex';
import {
  rowToContentRating,
  type ContentRating,
  type ContentRatingAggregate,
  type ContentRatingRow,
} from '../domain/content.types.js';

const T = 'content_ratings';

/** One 1-5 rating per (content, user) — upsert on resubmit. Mirrors `organization_reviews`. */
export class ContentRatingRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async upsert(
    contentId: string,
    userId: string,
    rating: number,
    trx?: Knex.Transaction,
  ): Promise<ContentRating> {
    const [row] = (await this.conn(trx)(T)
      .insert({ content_id: contentId, user_id: userId, rating })
      .onConflict(['content_id', 'user_id'])
      .merge({ rating, updated_at: new Date() })
      .returning('*')) as ContentRatingRow[];
    if (!row) throw new Error('content rating upsert did not return a row');
    return rowToContentRating(row);
  }

  async findOwn(
    contentId: string,
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<ContentRating | null> {
    const row = await this.conn(trx)<ContentRatingRow>(T)
      .where({ content_id: contentId, user_id: userId })
      .first();
    return row ? rowToContentRating(row) : null;
  }

  async aggregate(contentId: string, trx?: Knex.Transaction): Promise<ContentRatingAggregate> {
    const row = await this.conn(trx)(T)
      .where({ content_id: contentId })
      .avg<{ avg: string | null }>({ avg: 'rating' })
      .count<{ count: string }>({ count: '*' })
      .first();
    const count = Number(row?.count ?? 0);
    const average = row?.avg == null ? null : Math.round(Number(row.avg) * 10) / 10;
    return { average: count > 0 ? average : null, count };
  }

  /** Batched counterpart of {@link aggregate} for a page of content — one grouped query. */
  async aggregateMany(
    contentIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, ContentRatingAggregate>> {
    const result = new Map<string, ContentRatingAggregate>();
    if (contentIds.length === 0) return result;

    const conn = this.conn(trx);
    const rows: { content_id: string; avg: string | null; count: string }[] = await conn(T)
      .whereIn('content_id', contentIds)
      .groupBy('content_id')
      .select('content_id', conn.raw('avg(rating) as avg'), conn.raw('count(*) as count'));

    for (const row of rows) {
      const count = Number(row.count);
      const average = row.avg == null ? null : Math.round(Number(row.avg) * 10) / 10;
      result.set(row.content_id, { average: count > 0 ? average : null, count });
    }
    return result;
  }
}
