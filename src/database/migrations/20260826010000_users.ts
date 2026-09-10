import type { Knex } from 'knex';

/**
 * Phase 2 — Identity: the `users` table.
 *
 * - UUID PK (`gen_random_uuid()` from the Phase 1 `pgcrypto` extension).
 * - `email` is `citext` + unique (case-insensitive uniqueness at the DB level).
 * - `status` / `veterinarian_status` are text + CHECK constraints; the canonical
 *   value lists live in application code (`user.types.ts`).
 * - No hard delete for identity records — use SUSPENDED / DEACTIVATED.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.specificType('email', 'citext').notNullable().unique();
    t.text('password_hash').notNullable();
    t.text('first_name').notNullable();
    t.text('last_name').notNullable();
    t.text('phone').nullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.text('veterinarian_status').notNullable().defaultTo('NOT_APPLIED');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Optional profile fields, collected at registration or later via the
    // profile / avatar endpoints. All nullable, no backfill.
    t.text('gender').nullable();
    t.text('country').nullable();
    t.text('avatar_key').nullable();
    // Poultry Markets trader registration — kept in sync with
    // `trader_profiles.status` (see `20260917010000_trader_profiles.ts`,
    // which owns that table) so it can ship cheaply in the session payload.
    t.text('trader_status').notNullable().defaultTo('NOT_REGISTERED');

    t.index('status', 'idx_users_status');
    t.index('veterinarian_status', 'idx_users_vet_status');
  });

  await knex.raw(`
    ALTER TABLE users
      ADD CONSTRAINT chk_users_status
      CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'))
  `);
  await knex.raw(`
    ALTER TABLE users
      ADD CONSTRAINT chk_users_vet_status
      CHECK (veterinarian_status IN ('NOT_APPLIED', 'PENDING', 'APPROVED', 'REJECTED'))
  `);
  await knex.raw(
    `ALTER TABLE users ADD CONSTRAINT chk_users_gender CHECK (gender IN ('MALE', 'FEMALE'))`,
  );
  await knex.raw(
    `ALTER TABLE users ADD CONSTRAINT chk_users_country CHECK (country ~ '^[A-Z]{2}$')`,
  );
  await knex.raw(`
    ALTER TABLE users
      ADD CONSTRAINT chk_users_trader_status
      CHECK (trader_status IN ('NOT_REGISTERED', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
