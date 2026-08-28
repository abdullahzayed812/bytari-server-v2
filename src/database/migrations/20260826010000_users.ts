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
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
