import type { Knex } from 'knex';

/**
 * Per-user tip engagement: `tip_bookmarks` (save) and `tip_reactions`
 * (helpful). Idempotent toggles — the service pairs a reaction write with the
 * denormalised `content_tips.helpful_count` update in one transaction.
 */
export class TipEngagementRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  // --- bookmarks -----------------------------------------------

  async isBookmarked(userId: string, tipId: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)('tip_bookmarks')
      .where({ user_id: userId, tip_id: tipId })
      .first();
    return Boolean(row);
  }

  async bookmarkedSet(
    userId: string,
    tipIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Set<string>> {
    if (tipIds.length === 0) return new Set();
    const rows: Array<{ tip_id: string }> = await this.conn(trx)('tip_bookmarks')
      .where('user_id', userId)
      .whereIn('tip_id', tipIds)
      .select('tip_id');
    return new Set(rows.map((r) => r.tip_id));
  }

  /** @returns `true` when a row was inserted, `false` when it already existed. */
  async addBookmark(userId: string, tipId: string, trx: Knex.Transaction): Promise<boolean> {
    const inserted = await trx('tip_bookmarks')
      .insert({ user_id: userId, tip_id: tipId })
      .onConflict(['user_id', 'tip_id'])
      .ignore()
      .returning('tip_id');
    return inserted.length > 0;
  }

  /** @returns number of rows removed (0 or 1). */
  async removeBookmark(userId: string, tipId: string, trx: Knex.Transaction): Promise<number> {
    return trx('tip_bookmarks').where({ user_id: userId, tip_id: tipId }).del();
  }

  // --- reactions (helpful) ------------------------------------

  async isHelpful(userId: string, tipId: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)('tip_reactions')
      .where({ user_id: userId, tip_id: tipId, kind: 'HELPFUL' })
      .first();
    return Boolean(row);
  }

  async helpfulSet(userId: string, tipIds: string[], trx?: Knex.Transaction): Promise<Set<string>> {
    if (tipIds.length === 0) return new Set();
    const rows: Array<{ tip_id: string }> = await this.conn(trx)('tip_reactions')
      .where('user_id', userId)
      .where('kind', 'HELPFUL')
      .whereIn('tip_id', tipIds)
      .select('tip_id');
    return new Set(rows.map((r) => r.tip_id));
  }

  async addHelpful(userId: string, tipId: string, trx: Knex.Transaction): Promise<boolean> {
    const inserted = await trx('tip_reactions')
      .insert({ user_id: userId, tip_id: tipId, kind: 'HELPFUL' })
      .onConflict(['user_id', 'tip_id'])
      .ignore()
      .returning('tip_id');
    return inserted.length > 0;
  }

  async removeHelpful(userId: string, tipId: string, trx: Knex.Transaction): Promise<number> {
    return trx('tip_reactions').where({ user_id: userId, tip_id: tipId, kind: 'HELPFUL' }).del();
  }
}
