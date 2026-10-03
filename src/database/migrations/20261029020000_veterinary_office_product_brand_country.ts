import type { Knex } from 'knex';

/**
 * Additional corrections §10 — Veterinary Office product search: structured
 * `brand` and `country_of_origin` ("بلد المنشأ") so customers can filter an
 * office's catalog by them. Optional free text (existing products: NULL).
 * Trigram-free: lowercase btree indexes per office are enough for the
 * small per-office catalogs + the distinct-values facet query.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinary_office_products', (t) => {
    t.text('brand').nullable();
    t.text('country_of_origin').nullable();
  });
  await knex.raw(
    'CREATE INDEX idx_vop_org_brand ON veterinary_office_products (organization_id, lower(brand)) WHERE brand IS NOT NULL',
  );
  await knex.raw(
    'CREATE INDEX idx_vop_org_country ON veterinary_office_products (organization_id, lower(country_of_origin)) WHERE country_of_origin IS NOT NULL',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_vop_org_country');
  await knex.raw('DROP INDEX IF EXISTS idx_vop_org_brand');
  await knex.schema.alterTable('veterinary_office_products', (t) => {
    t.dropColumn('country_of_origin');
    t.dropColumn('brand');
  });
}
