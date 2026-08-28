import type { Knex } from 'knex';

/**
 * Phase 10 — Veterinary Store products.
 *
 * A Veterinary Store is an Organization of type `VETERINARY_STORE` (Phase 3 —
 * created via UC-010, admin-approved, Owner / Supervisors / Staff, organization
 * RBAC). This migration adds ONLY the `products` table.
 *
 * `products.organization_id` is pinned to a VETERINARY_STORE at the DATABASE
 * level: an immutable `organization_type` column (CHECK = 'VETERINARY_STORE')
 * + a composite FK to `organizations(id, type)` (the `uq_organizations_id_type`
 * unique constraint added in Phase 6). A product therefore can never reference a
 * CLINIC / FARM / VETERINARY_OFFICE organization.
 *
 * NOT modelled (spec defines no fields / out of Phase 10 scope): Pet Owner Store
 * products (separate future domain), product categories, product images
 * (R2 storage seam), SKU / barcode, orders / purchasing, an inventory movement
 * ledger. `stock_quantity` is a single controlled field adjusted only via the
 * dedicated stock endpoint.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('products', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable();
    t.text('organization_type').notNullable().defaultTo('VETERINARY_STORE');
    t.text('name').notNullable();
    t.text('description').nullable();
    t.text('product_type').notNullable();
    // Money: PostgreSQL numeric (never float). `pg` returns it as a string.
    t.decimal('price', 12, 2).nullable();
    t.integer('stock_quantity').notNullable().defaultTo(0);
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_products_org');
    t.index(['organization_id', 'status'], 'idx_products_org_status');

    t.foreign(['organization_id', 'organization_type'], 'fk_products_store')
      .references(['id', 'type'])
      .inTable('organizations')
      .onDelete('RESTRICT');
  });

  await knex.raw(
    `ALTER TABLE products ADD CONSTRAINT chk_products_org_type CHECK (organization_type = 'VETERINARY_STORE')`,
  );
  await knex.raw(
    `ALTER TABLE products ADD CONSTRAINT chk_products_status CHECK (status IN ('ACTIVE', 'INACTIVE'))`,
  );
  await knex.raw(
    `ALTER TABLE products ADD CONSTRAINT chk_products_type
       CHECK (product_type IN ('MEDICINE', 'EQUIPMENT', 'SUPPLY', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE products ADD CONSTRAINT chk_products_price CHECK (price IS NULL OR price >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE products ADD CONSTRAINT chk_products_stock CHECK (stock_quantity >= 0)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('products');
}
