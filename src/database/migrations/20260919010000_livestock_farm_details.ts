import type { Knex } from 'knex';

/**
 * Sheep Farms & Cattle Farms — additive `farm_details` columns shared by all
 * three species (Poultry/Sheep/Cattle/Mixed). Purely additive/nullable: no
 * existing poultry row or behavior changes.
 *
 *   - `farm_species`            — POULTRY|SHEEP|CATTLE|MIXED discriminator.
 *   - `current_sheep_count` / `current_cattle_count` — mirrors the existing
 *     `current_bird_count` declarative headline count, one per species.
 *   - `sheep_production_type` / `cattle_production_type` — mirrors the
 *     existing `poultry_production_type` (renamed from `farm_category`) —
 *     each species gets its own production-focus enum.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('farm_details', (t) => {
    t.text('farm_species').nullable();
    t.integer('current_sheep_count').nullable();
    t.integer('current_cattle_count').nullable();
    t.text('sheep_production_type').nullable();
    t.text('cattle_production_type').nullable();
  });
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_species
       CHECK (farm_species IS NULL OR farm_species IN ('POULTRY', 'SHEEP', 'CATTLE', 'MIXED'))`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_sheep_count
       CHECK (current_sheep_count IS NULL OR current_sheep_count >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_cattle_count
       CHECK (current_cattle_count IS NULL OR current_cattle_count >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_sheep_production_type
       CHECK (sheep_production_type IS NULL OR sheep_production_type IN
         ('MEAT', 'DAIRY', 'WOOL', 'BREEDING', 'MIXED', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_cattle_production_type
       CHECK (cattle_production_type IS NULL OR cattle_production_type IN
         ('DAIRY', 'BEEF', 'BREEDING', 'MIXED', 'OTHER'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  for (const c of [
    'chk_farm_details_species',
    'chk_farm_details_sheep_count',
    'chk_farm_details_cattle_count',
    'chk_farm_details_sheep_production_type',
    'chk_farm_details_cattle_production_type',
  ]) {
    await knex.raw(`ALTER TABLE farm_details DROP CONSTRAINT IF EXISTS ${c}`);
  }
  await knex.schema.alterTable('farm_details', (t) => {
    t.dropColumn('farm_species');
    t.dropColumn('current_sheep_count');
    t.dropColumn('current_cattle_count');
    t.dropColumn('sheep_production_type');
    t.dropColumn('cattle_production_type');
  });
}
