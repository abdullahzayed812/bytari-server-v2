import type { Knex } from 'knex';
import type { AiSettingKey } from '../domain/thread.constants.js';

const TABLE = 'ai_settings';

export interface AiSettingRow {
  key: string;
  enabled: boolean;
  updated_by_user_id: string | null;
  updated_at: Date;
}

/**
 * Tiny admin-owned flag store. No FK to `users` (see the migration header), so
 * reads default to `false` when a row is absent and writes upsert by `key`.
 */
export class AiSettingsRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async isEnabled(key: AiSettingKey, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)<AiSettingRow>(TABLE).where({ key }).first();
    return row?.enabled ?? false;
  }

  async all(trx?: Knex.Transaction): Promise<AiSettingRow[]> {
    return this.conn(trx)<AiSettingRow>(TABLE).orderBy('key');
  }

  async setEnabled(
    key: AiSettingKey,
    enabled: boolean,
    updatedByUserId: string,
    trx: Knex.Transaction,
  ): Promise<AiSettingRow> {
    const patch = { enabled, updated_by_user_id: updatedByUserId, updated_at: trx.fn.now() };
    const updated = (await trx(TABLE)
      .where({ key })
      .update(patch)
      .returning('*')) as AiSettingRow[];
    if (updated[0]) return updated[0];

    // Row missing (should not happen — the migration seeds both keys). Self-heal.
    const inserted = (await trx(TABLE)
      .insert({ key, ...patch })
      .returning('*')) as AiSettingRow[];
    if (!inserted[0]) throw new Error('ai_settings write returned no row');
    return inserted[0];
  }
}
