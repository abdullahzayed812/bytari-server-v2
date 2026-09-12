import type { Knex } from 'knex';

/**
 * Multi-section advertisement system:
 *
 *   ad_campaigns (placement, type BANNER|CAROUSEL, active, window, priority)
 *     └── ad_slides (ordered: image + title/subtitle/CTA)
 *
 * `placement` carries every ad slot used across the platform (consolidated
 * here rather than widened by a chain of later migrations — a future section
 * only ever adds a value to `AD_PLACEMENTS` + this one CHECK, never a new
 * table or API).
 *
 * `ad_slides` keeps the constraint/index names it had as the original
 * `home_ads` table (its very first shape, before this system existed) —
 * they were never renamed when the table itself was, so `home_ads_pkey` /
 * `home_ads_created_by_user_id_foreign` / `home_ads_updated_by_user_id_foreign`
 * are intentional, matching the live schema exactly.
 */
export async function up(knex: Knex): Promise<void> {
  // --- parent: ad_campaigns -------------------------------------
  await knex.schema.createTable('ad_campaigns', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('placement').notNullable();
    t.text('type').notNullable().defaultTo('BANNER');
    t.text('title').notNullable();
    t.boolean('is_active').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('starts_at', { useTz: true }).nullable();
    t.timestamp('ends_at', { useTz: true }).nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
      CHECK (placement IN (
        'HOME', 'PETS', 'POULTRY_FARMS', 'CLINICS', 'VETERINARY_OFFICES',
        'VETERINARY_STORES', 'PET_OWNER_STORE', 'VETERINARIAN_STORE', 'CONSULTATIONS', 'COURSES',
        'SEMINARS', 'POULTRY_MARKET', 'EGG_MARKET', 'EXCHANGE_RATES',
        'TRADER_REGISTRATION', 'SHEEP_FARMS', 'CATTLE_FARMS', 'VETERINARIAN_HOME'
      ))
  `);
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_type
       CHECK (type IN ('BANNER', 'CAROUSEL'))`,
  );
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_title_len
       CHECK (char_length(title) BETWEEN 1 AND 200)`,
  );
  await knex.raw(`
    CREATE INDEX idx_ad_campaigns_public ON ad_campaigns (placement, sort_order, created_at)
      WHERE is_active = true AND deleted_at IS NULL
  `);
  await knex.raw(
    `CREATE INDEX idx_ad_campaigns_admin ON ad_campaigns (placement, created_at DESC)`,
  );

  // --- child: ad_slides (constraint names inherited from `home_ads`) ---
  await knex.schema.createTable('ad_slides', (t) => {
    t.uuid('id').primary('home_ads_pkey').defaultTo(knex.raw('gen_random_uuid()'));
    t.text('title').nullable();
    t.text('subtitle').nullable();
    t.text('image_storage_key').nullable();
    t.text('image_storage_provider').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .withKeyName('home_ads_created_by_user_id_foreign');
    t.uuid('updated_by_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .withKeyName('home_ads_updated_by_user_id_foreign');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('campaign_id')
      .notNullable()
      .references('id')
      .inTable('ad_campaigns')
      .onDelete('CASCADE');
    t.text('cta_label').nullable();
    t.text('cta_url').nullable();
  });
  await knex.raw(
    `ALTER TABLE ad_slides ADD CONSTRAINT chk_ad_slides_title_len
       CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200)`,
  );
  await knex.raw(`CREATE INDEX idx_ad_slides_campaign ON ad_slides (campaign_id, sort_order)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ad_slides');
  await knex.schema.dropTableIfExists('ad_campaigns');
}
