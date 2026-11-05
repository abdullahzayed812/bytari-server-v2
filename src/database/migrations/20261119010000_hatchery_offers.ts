import type { Knex } from 'knex';

/**
 * Poultry Markets — "عروض المفاقس" (Hatchery Offers). Same lifecycle as
 * `egg_offers` / `poultry_offers` (ACTIVE / REMOVED owner-or-admin removal
 * flag + PENDING → APPROVED / REJECTED moderation, see
 * `20261026060000_market_offer_moderation.ts`) with hatchery-specific fields:
 * chick type + breed, chick age (days), and the production / listing day.
 * Quantity and price per chick are optional — a hatchery may advertise
 * availability only and agree the price by phone.
 *
 * Also widens `chk_ad_campaigns_placement` with `HATCHERY_MARKET` so the new
 * page gets its own ad slot like the egg market (`EGG_MARKET`).
 */
const PLACEMENTS_BEFORE = [
  'HOME',
  'PETS',
  'POULTRY_FARMS',
  'CLINICS',
  'VETERINARY_OFFICES',
  'VETERINARY_STORES',
  'PET_OWNER_STORE',
  'VETERINARIAN_STORE',
  'CONSULTATIONS',
  'COURSES',
  'SEMINARS',
  'POULTRY_MARKET',
  'EGG_MARKET',
  'EXCHANGE_RATES',
  'TRADER_REGISTRATION',
  'SHEEP_FARMS',
  'CATTLE_FARMS',
  'VETERINARIAN_HOME',
];

function placementCheck(values: string[]): string {
  return `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
    CHECK (placement IN (${values.map((v) => `'${v}'`).join(', ')}))`;
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('hatchery_offers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('trader_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('chick_type').notNullable().defaultTo('BROILER');
    t.text('breed').nullable();
    t.integer('chick_age_days').notNullable().defaultTo(1);
    t.date('production_date').notNullable();
    t.integer('quantity').nullable();
    t.decimal('price_per_chick', 12, 2).nullable();
    t.text('governorate').notNullable();
    t.text('district').nullable();
    t.text('phone').notNullable();
    t.text('whatsapp').nullable();
    t.text('notes').nullable();
    t.specificType('gallery_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.text('moderation_status').notNullable().defaultTo('PENDING');
    t.text('rejection_reason').nullable();
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['status', 'governorate'], 'idx_hatchery_offers_status_governorate');
    t.index(['status', 'chick_type'], 'idx_hatchery_offers_status_chick_type');
    t.index(['moderation_status', 'status'], 'idx_hatchery_offers_moderation');
    t.index('trader_user_id', 'idx_hatchery_offers_trader');
  });

  await knex.raw(`
    ALTER TABLE hatchery_offers
      ADD CONSTRAINT chk_hatchery_offers_chick_type
        CHECK (chick_type IN ('BROILER', 'LAYER', 'BALADI', 'TURKEY', 'DUCK', 'QUAIL', 'OTHER')),
      ADD CONSTRAINT chk_hatchery_offers_age CHECK (chick_age_days BETWEEN 0 AND 365),
      ADD CONSTRAINT chk_hatchery_offers_quantity CHECK (quantity IS NULL OR quantity >= 1),
      ADD CONSTRAINT chk_hatchery_offers_price CHECK (price_per_chick IS NULL OR price_per_chick >= 0),
      ADD CONSTRAINT chk_hatchery_offers_status CHECK (status IN ('ACTIVE', 'REMOVED')),
      ADD CONSTRAINT chk_hatchery_offers_moderation_status
        CHECK (moderation_status IN ('PENDING', 'APPROVED', 'REJECTED')),
      ADD CONSTRAINT chk_hatchery_offers_gallery_limit
        CHECK (array_length(gallery_keys, 1) IS NULL OR array_length(gallery_keys, 1) <= 4)
  `);

  await knex.raw(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS chk_ad_campaigns_placement`);
  await knex.raw(placementCheck([...PLACEMENTS_BEFORE, 'HATCHERY_MARKET']));
}

export async function down(knex: Knex): Promise<void> {
  await knex('ad_campaigns').where({ placement: 'HATCHERY_MARKET' }).delete();
  await knex.raw(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS chk_ad_campaigns_placement`);
  await knex.raw(placementCheck(PLACEMENTS_BEFORE));
  await knex.schema.dropTableIfExists('hatchery_offers');
}
