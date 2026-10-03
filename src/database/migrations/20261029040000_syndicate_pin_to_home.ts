import type { Knex } from 'knex';

/**
 * Additional corrections §12 — "تثبيت في الرئيسية": a syndicate pinned by
 * the administration appears at the bottom of the Veterinarian Home (below
 * Books & Magazines). `pinned_to_home_at` NULL = not pinned; the timestamp
 * orders pinned syndicates (oldest pin first).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('syndicate_details', (t) => {
    t.timestamp('pinned_to_home_at', { useTz: true }).nullable();
  });
  await knex.raw(
    'CREATE INDEX idx_syndicate_details_pinned ON syndicate_details (pinned_to_home_at) WHERE pinned_to_home_at IS NOT NULL',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_syndicate_details_pinned');
  await knex.schema.alterTable('syndicate_details', (t) => {
    t.dropColumn('pinned_to_home_at');
  });
}
