import type { Knex } from 'knex';

/**
 * Rich display fields for the Veterinary Offices product-details screen — all
 * optional free text, same "extend the CHECK / add the column, never a new
 * catalogue table" philosophy as the rest of this module. `highlights` is a
 * short list of badge-style callouts (e.g. "نتائج سريعة"). `primary_image_key`
 * mirrors the first uploaded image, same convention as
 * `pet_owner_store_products.primary_image_key`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinary_store_products', (t) => {
    t.text('subtype').nullable();
    t.text('weight').nullable();
    t.text('usage_instructions').nullable();
    t.text('dosage').nullable();
    t.text('shelf_life').nullable();
    t.text('manufacturer').nullable();
    t.specificType('highlights', 'text[]').notNullable().defaultTo('{}');
    t.text('primary_image_key').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinary_store_products', (t) => {
    t.dropColumn('primary_image_key');
    t.dropColumn('highlights');
    t.dropColumn('manufacturer');
    t.dropColumn('shelf_life');
    t.dropColumn('dosage');
    t.dropColumn('usage_instructions');
    t.dropColumn('weight');
    t.dropColumn('subtype');
  });
}
