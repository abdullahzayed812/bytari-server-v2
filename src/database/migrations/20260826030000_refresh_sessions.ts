import type { Knex } from 'knex';

/**
 * Phase 2 — Authentication: refresh sessions (one row per device/session).
 *
 * - Only a SHA-256 hash of the raw refresh token is stored (`token_hash`).
 * - Rotation: on refresh the old row is revoked and `replaced_by_session_id`
 *   points at the new row. Presenting an already-revoked token that has a
 *   successor is treated as replay → revoke the whole user's sessions.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('refresh_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('token_hash').notNullable().unique();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('last_used_at', { useTz: true }).nullable();
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.uuid('replaced_by_session_id')
      .nullable()
      .references('id')
      .inTable('refresh_sessions')
      .onDelete('SET NULL');
    t.text('user_agent').nullable();
    t.text('ip').nullable();

    t.index('user_id', 'idx_refresh_sessions_user');
  });

  // Fast lookup of a user's live sessions.
  await knex.raw(`
    CREATE INDEX idx_refresh_sessions_user_active
      ON refresh_sessions (user_id)
      WHERE revoked_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_sessions');
}
