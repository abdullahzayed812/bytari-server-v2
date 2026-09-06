import type { Knex } from 'knex';

/**
 * Poultry Markets module — daily governorate price boards ("bourse"). Two
 * conceptual boards (POULTRY: live meat/layer bird prices; EGG: egg-tray
 * price) share one table via a `board` discriminator — identical
 * entry/view/trend workflow, only the value-column count differs. Admin or an
 * authorized `MARKET` system-supervisor "saves" a whole day's rows at once
 * (upsert on the `(board, governorate, rate_date)` unique key).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('market_exchange_rates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('board').notNullable();
    t.text('governorate').notNullable();
    t.date('rate_date').notNullable();
    t.decimal('meat_price_per_kg', 12, 2).nullable();
    t.decimal('layer_price_per_bird', 12, 2).nullable();
    t.decimal('egg_price_per_tray', 12, 2).nullable();
    t.uuid('recorded_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE market_exchange_rates ADD CONSTRAINT chk_market_rates_board
      CHECK (board IN ('POULTRY', 'EGG'))
  `);
  await knex.raw(`
    ALTER TABLE market_exchange_rates ADD CONSTRAINT chk_market_rates_board_columns
      CHECK (
        (board = 'POULTRY' AND egg_price_per_tray IS NULL)
        OR (board = 'EGG' AND meat_price_per_kg IS NULL AND layer_price_per_bird IS NULL)
      )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_market_rates_board_governorate_date
      ON market_exchange_rates (board, governorate, rate_date)
  `);
  await knex.raw(`
    CREATE INDEX idx_market_rates_board_date ON market_exchange_rates (board, rate_date)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('market_exchange_rates');
}
