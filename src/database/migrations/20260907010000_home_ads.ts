import type { Knex } from 'knex';

/**
 * Pet Owner Home — promotional banner carousel ("home ads"). Admin-managed
 * (or a HOME_AD system-supervisor); public reads are any authenticated user.
 *
 * Deliberately simpler than `contents` (Phase 14): no lifecycle state machine,
 * no categories, a single image per ad. `is_active` gates public visibility
 * directly; the image is METADATA ONLY (`image_storage_key`) — bytes live in
 * Object Storage, never in Postgres, same convention as `content_files`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('home_ads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('title').notNullable();
    t.text('subtitle').nullable();
    t.text('image_storage_key').nullable();
    t.text('image_storage_provider').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(false);
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE home_ads ADD CONSTRAINT chk_home_ads_title_len CHECK (char_length(title) BETWEEN 1 AND 200)`,
  );
  // The hot public query: active, imaged, not deleted, in display order.
  await knex.raw(`
    CREATE INDEX idx_home_ads_public ON home_ads (sort_order, created_at)
      WHERE is_active = true AND deleted_at IS NULL AND image_storage_key IS NOT NULL
  `);
  await knex.raw(`CREATE INDEX idx_home_ads_admin ON home_ads (created_at DESC)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('home_ads');
}
