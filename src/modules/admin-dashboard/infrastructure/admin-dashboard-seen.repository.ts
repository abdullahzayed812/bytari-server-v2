import type { Knex } from 'knex';
import type { AdminDashboardCardId } from '../domain/admin-dashboard.types.js';

interface SeenRow {
  card_id: string;
  seen_at: Date;
}

/**
 * `admin_dashboard_card_seen` — one row per (user, card) marking when that
 * admin/supervisor last opened that ManagementScreen box. Backs the "new
 * since last look" badge counts (spec §4-§8); never a total.
 */
export class AdminDashboardSeenRepository {
  constructor(private readonly db: Knex) {}

  /** All of this user's cursors in one query, keyed by card id. */
  async getSeenMap(userId: string): Promise<Map<AdminDashboardCardId, Date>> {
    const rows = await this.db<SeenRow>('admin_dashboard_card_seen')
      .select('card_id', 'seen_at')
      .where('user_id', userId);
    return new Map(rows.map((r) => [r.card_id as AdminDashboardCardId, r.seen_at]));
  }

  /** Marks one card seen now for this user — resets its badge to 0. */
  async markSeen(userId: string, cardId: AdminDashboardCardId): Promise<void> {
    await this.db('admin_dashboard_card_seen')
      .insert({ user_id: userId, card_id: cardId, seen_at: this.db.fn.now() })
      .onConflict(['user_id', 'card_id'])
      .merge({ seen_at: this.db.fn.now() });
  }
}
