import type { Knex } from 'knex';

/**
 * Per-user content engagement: `content_bookmarks` (save) and `content_likes`.
 * Idempotent toggles — mirrors `TipEngagementRepository` exactly. The service
 * pairs a like write with the denormalised `contents.like_count` update in one
 * transaction.
 */
export class ContentEngagementRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  // --- bookmarks -----------------------------------------------

  async isBookmarked(userId: string, contentId: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)('content_bookmarks')
      .where({ user_id: userId, content_id: contentId })
      .first();
    return Boolean(row);
  }

  async bookmarkedSet(
    userId: string,
    contentIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Set<string>> {
    if (contentIds.length === 0) return new Set();
    const rows: Array<{ content_id: string }> = await this.conn(trx)('content_bookmarks')
      .where('user_id', userId)
      .whereIn('content_id', contentIds)
      .select('content_id');
    return new Set(rows.map((r) => r.content_id));
  }

  /** @returns `true` when a row was inserted, `false` when it already existed. */
  async addBookmark(userId: string, contentId: string, trx: Knex.Transaction): Promise<boolean> {
    const inserted = await trx('content_bookmarks')
      .insert({ user_id: userId, content_id: contentId })
      .onConflict(['user_id', 'content_id'])
      .ignore()
      .returning('content_id');
    return inserted.length > 0;
  }

  /** @returns number of rows removed (0 or 1). */
  async removeBookmark(userId: string, contentId: string, trx: Knex.Transaction): Promise<number> {
    return trx('content_bookmarks').where({ user_id: userId, content_id: contentId }).del();
  }

  // --- likes -----------------------------------------------------

  async isLiked(userId: string, contentId: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)('content_likes')
      .where({ user_id: userId, content_id: contentId })
      .first();
    return Boolean(row);
  }

  async likedSet(userId: string, contentIds: string[], trx?: Knex.Transaction): Promise<Set<string>> {
    if (contentIds.length === 0) return new Set();
    const rows: Array<{ content_id: string }> = await this.conn(trx)('content_likes')
      .where('user_id', userId)
      .whereIn('content_id', contentIds)
      .select('content_id');
    return new Set(rows.map((r) => r.content_id));
  }

  async addLike(userId: string, contentId: string, trx: Knex.Transaction): Promise<boolean> {
    const inserted = await trx('content_likes')
      .insert({ user_id: userId, content_id: contentId })
      .onConflict(['user_id', 'content_id'])
      .ignore()
      .returning('content_id');
    return inserted.length > 0;
  }

  async removeLike(userId: string, contentId: string, trx: Knex.Transaction): Promise<number> {
    return trx('content_likes').where({ user_id: userId, content_id: contentId }).del();
  }
}
