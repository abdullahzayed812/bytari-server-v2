import type { Knex } from 'knex';

/**
 * Mobile Auth & Registration — optional profile fields collected at
 * registration (or later via the profile / avatar endpoints). All nullable,
 * no backfill: existing rows simply have `NULL` here until the user sets them.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.text('gender').nullable();
    t.text('country').nullable();
    t.text('avatar_key').nullable();
  });
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT chk_users_gender CHECK (gender IN ('MALE', 'FEMALE'))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT chk_users_country CHECK (country ~ '^[A-Z]{2}$')`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('gender');
    t.dropColumn('country');
    t.dropColumn('avatar_key');
  });
}
