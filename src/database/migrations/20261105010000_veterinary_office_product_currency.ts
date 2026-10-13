import type { Knex } from 'knex';

/**
 * Veterinary Office / company products: the seller picks the price currency —
 * Iraqi Dinar (`IQD`) or US Dollar (`USD`). Every existing price was entered
 * and shown in dinars ("د.ع"), so legacy rows become `IQD` through the column
 * default — a label, not a conversion; amounts are untouched.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinary_office_products', (t) => {
    t.text('currency').notNullable().defaultTo('IQD');
  });
  await knex.raw(
    `ALTER TABLE veterinary_office_products ADD CONSTRAINT chk_vop_currency CHECK (currency IN ('IQD', 'USD'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE veterinary_office_products DROP CONSTRAINT IF EXISTS chk_vop_currency',
  );
  await knex.schema.alterTable('veterinary_office_products', (t) => {
    t.dropColumn('currency');
  });
}
