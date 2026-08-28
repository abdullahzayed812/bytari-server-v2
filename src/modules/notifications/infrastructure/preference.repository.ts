import type { Knex } from 'knex';

const T = 'notification_preferences';

export interface NotificationPreferences {
  userId: string;
  pushEnabled: boolean;
  updatedAt: string;
}

interface PreferenceRow {
  user_id: string;
  push_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Per-user notification preferences. Only `push_enabled` today — in-app
 * notifications are always created. The row is created lazily; a missing row
 * means "all defaults" (`push_enabled = true`).
 */
export class PreferenceRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async get(userId: string, trx?: Knex.Transaction): Promise<NotificationPreferences> {
    const row = await this.conn(trx)<PreferenceRow>(T).where({ user_id: userId }).first();
    return {
      userId,
      pushEnabled: row ? row.push_enabled : true,
      updatedAt: row ? row.updated_at.toISOString() : new Date(0).toISOString(),
    };
  }

  async pushEnabled(userId: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)<PreferenceRow>(T)
      .where({ user_id: userId })
      .select('push_enabled')
      .first();
    return row ? row.push_enabled : true;
  }

  async upsert(
    userId: string,
    patch: { pushEnabled: boolean },
    trx: Knex.Transaction,
  ): Promise<NotificationPreferences> {
    const now = trx.fn.now();
    const [row] = (await trx(T)
      .insert({ user_id: userId, push_enabled: patch.pushEnabled, updated_at: now })
      .onConflict('user_id')
      .merge({ push_enabled: patch.pushEnabled, updated_at: now })
      .returning('*')) as PreferenceRow[];
    if (!row) throw new Error('notification_preferences upsert returned no row');
    return { userId, pushEnabled: row.push_enabled, updatedAt: row.updated_at.toISOString() };
  }
}
