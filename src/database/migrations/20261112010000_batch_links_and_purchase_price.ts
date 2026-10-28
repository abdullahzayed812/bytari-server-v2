import type { Knex } from 'knex';

/**
 * 1. Manual farm expenses ("المصاريف") and farm appointments ("المواعيد") can
 *    be tied to a sheep or cattle batch, not just a poultry flock — so selling
 *    any batch kind can permanently delete the expenses and appointments that
 *    belong to it. At most one batch link per row (CHECK); a row with none is
 *    farm-wide and survives every sale. Deleting a batch keeps the row (SET
 *    NULL, as for `poultry_flock_id`).
 * 2. Batches record the PURCHASE price per kilogram, which replaces the
 *    expected sale price on the batch form. `target_price_per_kg` stays (older
 *    batches' estimated profit still reads it).
 */
const LINKED_TABLES = ['farm_expenses', 'farm_appointments'] as const;
const BATCH_TABLES = ['poultry_flocks', 'sheep_batches', 'cattle_batches'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of LINKED_TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.uuid('sheep_batch_id')
        .nullable()
        .references('id')
        .inTable('sheep_batches')
        .onDelete('SET NULL');
      t.uuid('cattle_batch_id')
        .nullable()
        .references('id')
        .inTable('cattle_batches')
        .onDelete('SET NULL');
      t.index('sheep_batch_id', `idx_${table}_sheep_batch`);
      t.index('cattle_batch_id', `idx_${table}_cattle_batch`);
    });
    await knex.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_single_batch
         CHECK (num_nonnulls(poultry_flock_id, sheep_batch_id, cattle_batch_id) <= 1)`,
    );
  }
  // The sale purge deletes appointments by flock; give that lookup an index too.
  await knex.schema.alterTable('farm_appointments', (t) => {
    t.index('poultry_flock_id', 'idx_farm_appointments_poultry_flock');
  });

  for (const table of BATCH_TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.decimal('purchase_price_per_kg', 14, 2).nullable();
    });
    await knex.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_purchase_price
         CHECK (purchase_price_per_kg IS NULL OR purchase_price_per_kg >= 0)`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of BATCH_TABLES) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_purchase_price`);
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('purchase_price_per_kg');
    });
  }
  await knex.raw('DROP INDEX IF EXISTS idx_farm_appointments_poultry_flock');
  for (const table of LINKED_TABLES) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_single_batch`);
    await knex.schema.alterTable(table, (t) => {
      t.dropIndex('sheep_batch_id', `idx_${table}_sheep_batch`);
      t.dropIndex('cattle_batch_id', `idx_${table}_cattle_batch`);
      t.dropColumn('sheep_batch_id');
      t.dropColumn('cattle_batch_id');
    });
  }
}
