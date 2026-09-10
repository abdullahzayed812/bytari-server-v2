import type { Knex } from 'knex';

/**
 * Product image gallery — one row per uploaded image, same shape as
 * `pet_owner_store_product_images`. Ordered by `sort_order`; the first image
 * is mirrored onto `veterinary_store_products.primary_image_key`
 * (application-managed, not a trigger).
 */
export async function up(knex: Knex): Promise<void> {
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
}
