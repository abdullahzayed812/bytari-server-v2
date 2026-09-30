import type { Knex } from 'knex';

/**
 * Consultation / inquiry / support replies may be IMAGE-ONLY (correction
 * phase 2026-09-30 §10): the body may be empty when at least one image is
 * attached — never both empty. Same 4000-char ceiling as before.
 */
const TABLES = ['consultation_messages', 'inquiry_messages', 'support_thread_messages'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_body_len`);
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_body_len CHECK (
        char_length(body) <= 4000 AND
        (char_length(body) >= 1 OR coalesce(array_length(image_keys, 1), 0) >= 1)
      )
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    // Image-only rows cannot satisfy the old rule — give them a placeholder body.
    await knex(table).where('body', '').update({ body: '📷' });
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_body_len`);
    await knex.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_body_len CHECK (char_length(body) BETWEEN 1 AND 4000)`,
    );
  }
}
