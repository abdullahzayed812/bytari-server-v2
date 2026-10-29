import type { Knex } from 'knex';

/**
 * The INTERNAL content of a syndicate service page (the requirement / info
 * pages: "إصدار / تجديد هوية نقابية", "الدعم القانوني", "إجازات المكاتب…") —
 * heading, intro text, ordered sections with ordered items, processing-time
 * line and note — becomes editable by the syndicate's managers. Stored as one
 * JSON document on the existing service row, so the service id / key /
 * syndicate never change and a save replaces the document atomically (no
 * duplicated sections or items). NULL = the app's built-in text, which is
 * exactly what every existing service shows today, so nothing is migrated.
 */
const CONTENT_KEYS = ['ID_CARD', 'LEGAL_SUPPORT', 'OFFICE_LICENSES'];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('syndicate_services', (t) => {
    t.jsonb('content').nullable();
  });
  await knex.raw(
    `ALTER TABLE syndicate_services ADD CONSTRAINT chk_syndicate_services_content
       CHECK (content IS NULL
          OR (jsonb_typeof(content) = 'object'
              AND service_key IN (${CONTENT_KEYS.map((k) => `'${k}'`).join(', ')})))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE syndicate_services DROP CONSTRAINT IF EXISTS chk_syndicate_services_content',
  );
  await knex.schema.alterTable('syndicate_services', (t) => {
    t.dropColumn('content');
  });
}
