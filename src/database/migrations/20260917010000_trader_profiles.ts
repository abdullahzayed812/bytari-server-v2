import type { Knex } from 'knex';

/**
 * Poultry Markets module — trader registration. A trader profile is a
 * per-USER concept (unique `user_id`), independent of any organization/farm —
 * a user may own zero, one, or several farms and registers as a trader at
 * most once. `users.trader_status` (consolidated in `20260826010000_users.ts`,
 * which owns `users`) is kept in sync with `trader_profiles.status` (mirrors
 * `users.veterinarian_status` / `veterinarian_applications`) so it can ship
 * cheaply in the session payload.
 *
 * Unlike the documents-only veterinarian-application flow, the trader form
 * carries substantive profile fields that get edited in place on reapply —
 * so this is a single mutable row per user, not an applications-history table.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('trader_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    t.text('display_name').notNullable();
    t.text('trader_type').notNullable().defaultTo('WHOLESALE');
    t.text('governorate').notNullable();
    t.text('district').nullable();
    t.text('phone').notNullable();
    t.text('whatsapp').nullable();
    t.text('bio').nullable();
    t.timestamp('terms_accepted_at', { useTz: true }).notNullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('decided_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.text('decision_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('status', 'idx_trader_profiles_status');
  });

  await knex.raw(`
    ALTER TABLE trader_profiles
      ADD CONSTRAINT chk_trader_profiles_trader_type
      CHECK (trader_type IN ('WHOLESALE', 'INDIVIDUAL', 'EXPORTER', 'OTHER'))
  `);
  await knex.raw(`
    ALTER TABLE trader_profiles
      ADD CONSTRAINT chk_trader_profiles_status
      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('trader_profiles');
}
