import type { Knex } from 'knex';

/**
 * "إعجاب" (like) on a public organization profile — a distinct engagement from
 * "متابعة" (follow). Until now the Clinic / Office details screens rendered the
 * FOLLOWERS count under the "likes" label and the heart toggled a follow; a like
 * had no storage at all. Same shape as `organization_follows`: one plain join
 * row per (organization, user) — the composite PK makes a double-like
 * impossible, so like / unlike are idempotent and the count is exact.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organization_likes', (t) => {
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.primary(['organization_id', 'user_id']);
    t.index('user_id', 'idx_organization_likes_user');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('organization_likes');
}
