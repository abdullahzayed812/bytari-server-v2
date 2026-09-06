import type { Knex } from 'knex';

/**
 * Poultry Markets module — egg classified offers. Same lifecycle shape as
 * `poultry_offers` (see that migration's header) but egg-specific fields:
 * `egg_type` + `sell_unit` (piece / 360-egg carton / 30-egg tray) instead of
 * bird type / pricing method.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('egg_offers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('trader_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('egg_type').notNullable().defaultTo('WHITE');
    t.text('sell_unit').notNullable().defaultTo('TRAY_30');
    t.integer('quantity').notNullable();
    t.decimal('price_per_unit', 12, 2).notNullable();
    t.text('governorate').notNullable();
    t.text('district').nullable();
    t.text('phone').notNullable();
    t.text('whatsapp').nullable();
    t.text('notes').nullable();
    t.specificType('gallery_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['status', 'governorate'], 'idx_egg_offers_status_governorate');
    t.index(['status', 'egg_type'], 'idx_egg_offers_status_egg_type');
    t.index('trader_user_id', 'idx_egg_offers_trader');
  });

  await knex.raw(`
    ALTER TABLE egg_offers ADD CONSTRAINT chk_egg_offers_egg_type
      CHECK (egg_type IN ('ORGANIC', 'BROWN', 'WHITE', 'OTHER', 'TURKEY', 'BALADI'))
  `);
  await knex.raw(`
    ALTER TABLE egg_offers ADD CONSTRAINT chk_egg_offers_sell_unit
      CHECK (sell_unit IN ('PIECE', 'CARTON_360', 'TRAY_30'))
  `);
  await knex.raw(`
    ALTER TABLE egg_offers ADD CONSTRAINT chk_egg_offers_status
      CHECK (status IN ('ACTIVE', 'REMOVED'))
  `);
  await knex.raw(
    `ALTER TABLE egg_offers ADD CONSTRAINT chk_egg_offers_quantity CHECK (quantity >= 1)`,
  );
  await knex.raw(
    `ALTER TABLE egg_offers ADD CONSTRAINT chk_egg_offers_price CHECK (price_per_unit >= 0)`,
  );
  await knex.raw(`
    ALTER TABLE egg_offers ADD CONSTRAINT chk_egg_offers_gallery_limit
      CHECK (array_length(gallery_keys, 1) IS NULL OR array_length(gallery_keys, 1) <= 4)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('egg_offers');
}
