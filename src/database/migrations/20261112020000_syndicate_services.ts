import type { Knex } from 'knex';

/**
 * "الخدمات" of a syndicate — until now six fixed tiles hard-coded in the app.
 * Each syndicate gets one row per service key (UNIQUE per syndicate, so an
 * edit always updates the same row and can never duplicate a service) whose
 * title / description / visibility its managers (`syndicate.profile.manage`)
 * can edit. NULL title / description = the app's built-in default text.
 * Existing syndicates are backfilled here; new ones get their rows on first
 * read (`SyndicateServiceItems.list`, INSERT … ON CONFLICT DO NOTHING).
 */
const SERVICE_KEYS = [
  'ID_CARD',
  'INQUIRY',
  'ANNOUNCEMENTS',
  'REGISTER_DOCTORS',
  'LEGAL_SUPPORT',
  'OFFICE_LICENSES',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('syndicate_services', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.text('service_key').notNullable();
    t.text('title').nullable();
    t.text('description').nullable();
    t.boolean('is_enabled').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable();
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['organization_id', 'service_key'], { indexName: 'uq_syndicate_services_org_key' });
  });
  await knex.raw(
    `ALTER TABLE syndicate_services ADD CONSTRAINT chk_syndicate_services_key
       CHECK (service_key IN (${SERVICE_KEYS.map((k) => `'${k}'`).join(', ')}))`,
  );
  await knex.raw(
    `ALTER TABLE syndicate_services ADD CONSTRAINT chk_syndicate_services_lengths
       CHECK ((title IS NULL OR char_length(title) BETWEEN 1 AND 120)
          AND (description IS NULL OR char_length(description) <= 4000))`,
  );
  await knex.raw(
    `INSERT INTO syndicate_services (organization_id, service_key, sort_order)
     SELECT o.id, k.key, k.ord
       FROM organizations o
       CROSS JOIN unnest(?::text[]) WITH ORDINALITY AS k(key, ord)
      WHERE o.type = 'SYNDICATE'
     ON CONFLICT (organization_id, service_key) DO NOTHING`,
    [SERVICE_KEYS],
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('syndicate_services');
}
