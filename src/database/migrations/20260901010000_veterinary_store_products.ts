import type { Knex } from 'knex';

/**
 * Veterinary Store products — a fully separate catalogue from Veterinary
 * Office products (`veterinary_office_products`, its own table/migration) and
 * Pet Owner Store products. No shared tables, DTOs, or business logic.
 *
 * `organization_id` is pinned to a VETERINARY_STORE at the DATABASE level: an
 * immutable `organization_type` column (CHECK = 'VETERINARY_STORE') + a
 * composite FK to `organizations(id, type)` (the `uq_organizations_id_type`
 * unique constraint from the organizations migration). A product therefore
 * can never reference a CLINIC / FARM / VETERINARY_OFFICE organization.
 *
 * This table (and its constraint/index names) was originally created as the
 * generically-named `products` and later renamed — `veterinary_store_products_pkey`
 * matches that rename, but `products_created_by_user_id_foreign` was never
 * renamed along with it (Postgres doesn't rename dependent constraint names on
 * a table rename), so it's kept exactly as it is live.
 *
 * `stock_quantity` is a single controlled field adjusted only via the
 * dedicated stock endpoint. `veterinary_store_product_images` is the image
 * gallery — one row per uploaded image, ordered by `sort_order`; the first
 * image is mirrored onto `primary_image_key` (application-managed, not a
 * trigger).
 *
 * NOT modelled: product categories, SKU / barcode, orders / purchasing, an
 * inventory movement ledger.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('veterinary_store_products', (t) => {
    t.uuid('id').primary('veterinary_store_products_pkey').defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable();
    t.text('organization_type').notNullable().defaultTo('VETERINARY_STORE');
    t.text('name').notNullable();
    t.text('description').nullable();
    t.text('product_type').notNullable();
    // Money: PostgreSQL numeric (never float). `pg` returns it as a string.
    t.decimal('price', 12, 2).nullable();
    t.integer('stock_quantity').notNullable().defaultTo(0);
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.uuid('created_by_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
      .withKeyName('products_created_by_user_id_foreign');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Rich display fields for the product-details screen — all optional.
    t.text('subtype').nullable();
    t.text('weight').nullable();
    t.text('usage_instructions').nullable();
    t.text('dosage').nullable();
    t.text('shelf_life').nullable();
    t.text('manufacturer').nullable();
    t.specificType('highlights', 'text[]').notNullable().defaultTo('{}');
    t.text('primary_image_key').nullable();

    t.index('organization_id', 'idx_vsp_org');
    t.index(['organization_id', 'status'], 'idx_vsp_org_status');

    t.foreign(['organization_id', 'organization_type'], 'fk_vsp_store')
      .references(['id', 'type'])
      .inTable('organizations')
      .onDelete('RESTRICT');
  });

  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_org_type CHECK (organization_type = 'VETERINARY_STORE')`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_status CHECK (status IN ('ACTIVE', 'INACTIVE'))`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_type
       CHECK (product_type IN ('MEDICINE', 'EQUIPMENT_SUPPLY', 'SUPPLEMENT', 'CARE'))`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_price CHECK (price IS NULL OR price >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_stock CHECK (stock_quantity >= 0)`,
  );

  await knex.schema.createTable('veterinary_store_product_images', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('product_id')
      .notNullable()
      .references('id')
      .inTable('veterinary_store_products')
      .onDelete('CASCADE');
    t.text('image_key').notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['product_id', 'sort_order'], 'idx_vsp_images_product');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('veterinary_store_product_images');
  await knex.schema.dropTableIfExists('veterinary_store_products');
}
