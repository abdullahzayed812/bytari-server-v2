import type { Knex } from 'knex';

/**
 * Poultry Markets module — poultry (live bird) classified offers. Every offer
 * belongs to exactly one trader user (`trader_user_id`) — auto-published
 * (`ACTIVE`) on creation for an approved trader, no per-offer moderation queue
 * (mirrors the veterinary-store `products` precedent).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('poultry_offers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('trader_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('bird_type').notNullable().defaultTo('BROILER');
    t.text('breed').nullable();
    t.integer('quantity').notNullable();
    t.text('pricing_method').notNullable().defaultTo('PER_KG');
    t.decimal('price', 12, 2).notNullable();
    t.integer('age_weeks').nullable();
    t.decimal('weight_kg', 6, 2).nullable();
    t.text('governorate').notNullable();
    t.text('district').nullable();
    t.text('phone').notNullable();
    t.text('whatsapp').nullable();
    t.text('notes').nullable();
    t.specificType('gallery_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['status', 'governorate'], 'idx_poultry_offers_status_governorate');
    t.index(['status', 'bird_type'], 'idx_poultry_offers_status_bird_type');
    t.index('trader_user_id', 'idx_poultry_offers_trader');
  });

  await knex.raw(`
    ALTER TABLE poultry_offers
      ADD CONSTRAINT chk_poultry_offers_bird_type
      CHECK (bird_type IN ('BALADI', 'LAYER', 'BROILER', 'ROOSTER', 'TURKEY', 'OTHER'))
  `);
  await knex.raw(`
    ALTER TABLE poultry_offers
      ADD CONSTRAINT chk_poultry_offers_pricing_method
      CHECK (pricing_method IN ('PER_KG', 'PER_BIRD'))
  `);
  await knex.raw(`
    ALTER TABLE poultry_offers ADD CONSTRAINT chk_poultry_offers_status
      CHECK (status IN ('ACTIVE', 'REMOVED'))
  `);
  await knex.raw(
    `ALTER TABLE poultry_offers ADD CONSTRAINT chk_poultry_offers_quantity CHECK (quantity >= 1)`,
  );
  await knex.raw(
    `ALTER TABLE poultry_offers ADD CONSTRAINT chk_poultry_offers_price CHECK (price >= 0)`,
  );
  await knex.raw(`
    ALTER TABLE poultry_offers ADD CONSTRAINT chk_poultry_offers_age_weeks
      CHECK (age_weeks IS NULL OR age_weeks >= 0)
  `);
  await knex.raw(`
    ALTER TABLE poultry_offers ADD CONSTRAINT chk_poultry_offers_weight_kg
      CHECK (weight_kg IS NULL OR weight_kg >= 0)
  `);
  await knex.raw(`
    ALTER TABLE poultry_offers ADD CONSTRAINT chk_poultry_offers_gallery_limit
      CHECK (array_length(gallery_keys, 1) IS NULL OR array_length(gallery_keys, 1) <= 5)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('poultry_offers');
}
