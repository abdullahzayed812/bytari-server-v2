import type { Knex } from 'knex';

/**
 * Per-(admin/supervisor, dashboard card) "last opened" cursor — backs the
 * ManagementScreen badge counts (spec §4-§8): a card's count is "items
 * created after this row's `seen_at`", not a total. No new notification
 * system: this is a minimal read-state cursor layered on the existing,
 * comprehensive audit/created-at trail every module already writes.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('admin_dashboard_card_seen', (t) => {
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('card_id', 64).notNullable();
    t.timestamp('seen_at', { useTz: true }).notNullable();
    t.primary(['user_id', 'card_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('admin_dashboard_card_seen');
}
