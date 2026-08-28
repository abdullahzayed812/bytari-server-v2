import type { Knex } from 'knex';

/**
 * Phase 1 baseline migration.
 *
 * Establishes database-level prerequisites that later phases rely on:
 *  - `pgcrypto`  → `gen_random_uuid()` for UUID primary keys.
 *  - `citext`    → case-insensitive text (emails, handles, org identifiers).
 *
 * No domain tables are created in Phase 1 — Identity & Authorization (Phase 2)
 * introduces the first ones.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "citext"');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP EXTENSION IF EXISTS "citext"');
  await knex.raw('DROP EXTENSION IF EXISTS "pgcrypto"');
}
