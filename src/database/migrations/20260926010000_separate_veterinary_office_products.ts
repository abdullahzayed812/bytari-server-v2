import type { Knex } from 'knex';

/**
 * Veterinary Office products — a fully separate catalogue from Veterinary
 * Store products (`veterinary_store_products`, its own table/migration). A
 * Veterinary Store never owns a Veterinary Office's products and vice versa,
 * enforced at the database level: own table, own composite FK pinned to one
 * organization type each, rather than a shared table with a discriminator
 * column.
 *
 * Mirrors `veterinary_store_products` exactly (same columns, same detail
 * fields, same constraints, own image gallery table) except the pinned
 * organization type.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('veterinary_office_products', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable();
    t.text('organization_type').notNullable().defaultTo('VETERINARY_OFFICE');
    t.text('name').notNullable();
    t.text('description').nullable();
    t.text('product_type').notNullable();
    t.decimal('price', 12, 2).nullable();
    t.integer('stock_quantity').notNullable().defaultTo(0);
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.text('subtype').nullable();
    t.text('weight').nullable();
    t.text('usage_instructions').nullable();
    t.text('dosage').nullable();
    t.text('shelf_life').nullable();
    t.text('manufacturer').nullable();
    t.specificType('highlights', 'text[]').notNullable().defaultTo('{}');
    t.text('primary_image_key').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_vop_org');
    t.index(['organization_id', 'status'], 'idx_vop_org_status');

    t.foreign(['organization_id', 'organization_type'], 'fk_vop_office')
      .references(['id', 'type'])
      .inTable('organizations')
      .onDelete('RESTRICT');
  });
  await knex.raw(
    `ALTER TABLE veterinary_office_products ADD CONSTRAINT chk_vop_org_type CHECK (organization_type = 'VETERINARY_OFFICE')`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_office_products ADD CONSTRAINT chk_vop_status CHECK (status IN ('ACTIVE', 'INACTIVE'))`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_office_products ADD CONSTRAINT chk_vop_type
       CHECK (product_type IN ('MEDICINE', 'EQUIPMENT_SUPPLY', 'SUPPLEMENT', 'CARE'))`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_office_products ADD CONSTRAINT chk_vop_price CHECK (price IS NULL OR price >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_office_products ADD CONSTRAINT chk_vop_stock CHECK (stock_quantity >= 0)`,
  );

  await knex.schema.createTable('veterinary_office_product_images', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('product_id')
      .notNullable()
      .references('id')
      .inTable('veterinary_office_products')
      .onDelete('CASCADE');
    t.text('image_key').notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['product_id', 'sort_order'], 'idx_vop_images_product');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('veterinary_office_product_images');
  await knex.schema.dropTableIfExists('veterinary_office_products');
}
