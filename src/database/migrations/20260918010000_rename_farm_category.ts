import type { Knex } from 'knex';

/**
 * Naming refactor (no behavior change): `farm_details.farm_category` is a
 * generic-sounding name for a column that is actually 100% poultry-specific
 * (its CHECK values are poultry production types — BROILER/LAYER/MIXED/
 * BREEDER/HATCHERY/OTHER). Renamed to `poultry_production_type` so a future
 * sheep/cattle-specific equivalent column doesn't have to share this
 * misleadingly-generic name. Plain column rename — same type, same CHECK
 * constraint, same data, same semantics.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('farm_details', (t) => {
    t.renameColumn('farm_category', 'poultry_production_type');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('farm_details', (t) => {
    t.renameColumn('poultry_production_type', 'farm_category');
  });
}
