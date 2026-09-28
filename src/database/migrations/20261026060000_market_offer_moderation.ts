import type { Knex } from 'knex';

/**
 * Poultry / egg market advertisements are now moderated: a new offer starts
 * PENDING and is public only once an ADMIN or a MARKET supervisor approves it
 * (REJECTED carries a reason). `status` (ACTIVE / REMOVED) stays the
 * owner/admin removal flag, orthogonal to moderation. Offers that were already
 * live keep being live — they are backfilled as APPROVED.
 */
const TABLES = ['poultry_offers', 'egg_offers'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.text('moderation_status').notNullable().defaultTo('PENDING');
      t.text('rejection_reason').nullable();
      t.uuid('reviewed_by_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
      t.timestamp('reviewed_at', { useTz: true }).nullable();
      t.index(['moderation_status', 'status'], `idx_${table}_moderation`);
    });
    await knex(table).update({ moderation_status: 'APPROVED' });
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_moderation_status
        CHECK (moderation_status IN ('PENDING', 'APPROVED', 'REJECTED'))
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_moderation_status`);
    await knex.schema.alterTable(table, (t) => {
      t.dropIndex(['moderation_status', 'status'], `idx_${table}_moderation`);
      t.dropColumn('moderation_status');
      t.dropColumn('rejection_reason');
      t.dropColumn('reviewed_by_user_id');
      t.dropColumn('reviewed_at');
    });
  }
}
