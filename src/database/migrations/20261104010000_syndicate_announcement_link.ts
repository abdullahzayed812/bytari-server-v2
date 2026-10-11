import type { Knex } from 'knex';

/**
 * Optional external link on a syndicate announcement ("رابط"). Plain text,
 * http(s) only — validated by the API (`linkUrlSchema`) and backed by a CHECK
 * so no other scheme (`javascript:`, `data:`, …) can ever be stored.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('syndicate_announcements', (t) => {
    t.text('link_url').nullable();
  });
  await knex.raw(`
    ALTER TABLE syndicate_announcements
      ADD CONSTRAINT chk_syndicate_announcements_link_url
      CHECK (link_url IS NULL OR (link_url ~* '^(http|https)://' AND length(link_url) <= 1000))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE syndicate_announcements DROP CONSTRAINT IF EXISTS chk_syndicate_announcements_link_url',
  );
  await knex.schema.alterTable('syndicate_announcements', (t) => {
    t.dropColumn('link_url');
  });
}
