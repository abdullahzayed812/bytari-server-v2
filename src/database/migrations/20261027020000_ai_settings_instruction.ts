import type { Knex } from 'knex';

/**
 * Admin-defined fixed AI instruction per AI setting key (CONSULTATION_AI /
 * INQUIRY_AI) — appended to the built-in system prompt when the AI answers a
 * consultation / inquiry. Nullable: absent = built-in prompt only. Additive.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ai_settings', (t) => {
    t.text('instruction').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ai_settings', (t) => {
    t.dropColumn('instruction');
  });
}
