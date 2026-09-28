import type { Knex } from 'knex';

/**
 * The platform stores (Pet Owners Store + Veterinarian Store) sell in Iraqi
 * Dinar. The currency column defaulted to 'SAR' and every row carried it,
 * while the amounts themselves were always entered in dinars — so this is a
 * relabel, NOT a conversion: amounts are left untouched, only the currency
 * code (and the column default for new rows) becomes 'IQD'. Orders keep their
 * snapshot amounts; their currency code is corrected the same way.
 */
const TABLES = [
  'pet_owner_store_products',
  'pet_owner_store_orders',
  'veterinarian_store_products',
  'veterinarian_store_orders',
] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE ${table} ALTER COLUMN currency SET DEFAULT 'IQD'`);
    await knex(table).where({ currency: 'SAR' }).update({ currency: 'IQD' });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE ${table} ALTER COLUMN currency SET DEFAULT 'SAR'`);
    await knex(table).where({ currency: 'IQD' }).update({ currency: 'SAR' });
  }
}
