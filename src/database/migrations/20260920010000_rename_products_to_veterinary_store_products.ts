import type { Knex } from 'knex';

/**
 * Rename the generically-named `products` table (introduced in
 * `20260901010000_veterinary_store_products.ts`) to `veterinary_store_products`.
 *
 * The table is, and always was, VETERINARY_STORE-specific — pinned to that
 * organization type by `chk_products_org_type` + the composite FK to
 * `organizations(id, type)`. The Pet Owners Store gets its own dedicated
 * `pet_owner_store_*` tables (next migration), so the two catalogues now have
 * clear, parallel names. Pure rename — no column or constraint semantics change.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE products RENAME TO veterinary_store_products');

  await knex.raw('ALTER INDEX idx_products_org RENAME TO idx_vsp_org');
  await knex.raw('ALTER INDEX idx_products_org_status RENAME TO idx_vsp_org_status');

  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT products_pkey TO veterinary_store_products_pkey',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT fk_products_store TO fk_vsp_store',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_products_org_type TO chk_vsp_org_type',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_products_status TO chk_vsp_status',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_products_type TO chk_vsp_type',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_products_price TO chk_vsp_price',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_products_stock TO chk_vsp_stock',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_vsp_stock TO chk_products_stock',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_vsp_price TO chk_products_price',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_vsp_type TO chk_products_type',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_vsp_status TO chk_products_status',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT chk_vsp_org_type TO chk_products_org_type',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT fk_vsp_store TO fk_products_store',
  );
  await knex.raw(
    'ALTER TABLE veterinary_store_products RENAME CONSTRAINT veterinary_store_products_pkey TO products_pkey',
  );

  await knex.raw('ALTER INDEX idx_vsp_org_status RENAME TO idx_products_org_status');
  await knex.raw('ALTER INDEX idx_vsp_org RENAME TO idx_products_org');

  await knex.raw('ALTER TABLE veterinary_store_products RENAME TO products');
}
