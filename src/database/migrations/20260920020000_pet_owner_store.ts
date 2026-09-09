import type { Knex } from 'knex';

/**
 * Pet Owners Store — a platform-run consumer storefront, dedicated tables,
 * logically separate from the VETERINARY_STORE inventory tool
 * (`veterinary_store_products`). The generic commerce *logic* (re-pricing,
 * stock decrement, totals, order state machine) lives in
 * `modules/pet-owner-store/domain/pet-owner-store.policy.ts` so a future
 * Veterinarians Store can reuse it against its own tables.
 *
 * Tables:
 *   pet_owner_store_categories       — filter/classification labels (+ home tiles)
 *   pet_owner_store_products         — the catalogue
 *   pet_owner_store_product_images   — ordered gallery (primary mirrored on product)
 *   pet_owner_store_carts            — one active cart per user
 *   pet_owner_store_cart_items       — cart lines
 *   pet_owner_store_orders           — placed orders (COD only for now)
 *   pet_owner_store_order_items      — immutable order lines (price/name snapshot)
 *
 * Money: PostgreSQL `numeric` (never float). `pg` returns it as a string.
 * Product images are R2 object keys only — no binaries, no storage secrets.
 */
export async function up(knex: Knex): Promise<void> {
  // --- categories --------------------------------------------------------
  await knex.schema.createTable('pet_owner_store_categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('slug').notNullable();
    t.text('name').notNullable();
    t.text('image_key').nullable();
    t.boolean('show_on_home').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE pet_owner_store_categories ADD CONSTRAINT chk_pos_categories_slug CHECK (slug ~ '^[a-z][a-z0-9-]{0,63}$')`,
  );
  await knex.raw(
    `ALTER TABLE pet_owner_store_categories ADD CONSTRAINT chk_pos_categories_status CHECK (status IN ('ACTIVE', 'INACTIVE'))`,
  );
  await knex.raw(`CREATE UNIQUE INDEX uq_pos_categories_slug ON pet_owner_store_categories (slug)`);

  // --- products --------------------------------------------------------
  await knex.schema.createTable('pet_owner_store_products', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('category_id')
      .nullable()
      .references('id')
      .inTable('pet_owner_store_categories')
      .onDelete('SET NULL');
    t.text('name').notNullable();
    t.text('description').nullable();
    t.decimal('price', 12, 2).notNullable();
    t.text('currency').notNullable().defaultTo('SAR');
    t.integer('stock_quantity').notNullable().defaultTo(0);
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.text('primary_image_key').nullable();
    /** Free-form spec chips shown on the details screen (الوزن / الفئة العمرية / النوع …). */
    t.jsonb('attributes').nullable();
    /** Display-only rating summary. No write path yet (columns reserved). */
    t.decimal('rating_average', 2, 1).nullable();
    t.integer('rating_count').notNullable().defaultTo(0);
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('status', 'idx_pos_products_status');
    t.index(['category_id', 'status'], 'idx_pos_products_category_status');
  });
  await knex.raw(
    `ALTER TABLE pet_owner_store_products ADD CONSTRAINT chk_pos_products_status CHECK (status IN ('ACTIVE', 'INACTIVE'))`,
  );
  await knex.raw(
    `ALTER TABLE pet_owner_store_products ADD CONSTRAINT chk_pos_products_price CHECK (price >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE pet_owner_store_products ADD CONSTRAINT chk_pos_products_stock CHECK (stock_quantity >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE pet_owner_store_products ADD CONSTRAINT chk_pos_products_rating CHECK (rating_average IS NULL OR (rating_average >= 0 AND rating_average <= 5))`,
  );
  await knex.raw(
    `CREATE INDEX idx_pos_products_name_lower ON pet_owner_store_products (lower(name))`,
  );

  // --- product images -------------------------------------------------
  await knex.schema.createTable('pet_owner_store_product_images', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('product_id')
      .notNullable()
      .references('id')
      .inTable('pet_owner_store_products')
      .onDelete('CASCADE');
    t.text('image_key').notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('product_id', 'idx_pos_product_images_product');
  });

  // --- carts --------------------------------------------------------
  await knex.schema.createTable('pet_owner_store_carts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`CREATE UNIQUE INDEX uq_pos_carts_user ON pet_owner_store_carts (user_id)`);

  await knex.schema.createTable('pet_owner_store_cart_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('cart_id')
      .notNullable()
      .references('id')
      .inTable('pet_owner_store_carts')
      .onDelete('CASCADE');
    t.uuid('product_id')
      .notNullable()
      .references('id')
      .inTable('pet_owner_store_products')
      .onDelete('RESTRICT');
    t.integer('quantity').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE pet_owner_store_cart_items ADD CONSTRAINT chk_pos_cart_items_qty CHECK (quantity > 0)`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_pos_cart_items_cart_product ON pet_owner_store_cart_items (cart_id, product_id)`,
  );

  // --- orders --------------------------------------------------------
  await knex.schema.createTable('pet_owner_store_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('order_number').notNullable();
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('payment_method').notNullable();
    t.text('payment_status').notNullable().defaultTo('UNPAID');
    t.decimal('subtotal_amount', 12, 2).notNullable();
    t.decimal('delivery_fee', 12, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 12, 2).notNullable();
    t.text('currency').notNullable().defaultTo('SAR');
    t.text('recipient_name').notNullable();
    t.text('recipient_phone').notNullable();
    t.text('city').notNullable();
    t.text('address_line').notNullable();
    t.text('note').nullable();
    t.timestamp('placed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['user_id', 'placed_at'], 'idx_pos_orders_user_placed');
    t.index('status', 'idx_pos_orders_status');
  });
  await knex.raw(
    `CREATE UNIQUE INDEX uq_pos_orders_number ON pet_owner_store_orders (order_number)`,
  );
  await knex.raw(
    `ALTER TABLE pet_owner_store_orders ADD CONSTRAINT chk_pos_orders_status
       CHECK (status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'))`,
  );
  await knex.raw(
    `ALTER TABLE pet_owner_store_orders ADD CONSTRAINT chk_pos_orders_payment_method
       CHECK (payment_method IN ('COD', 'MADA', 'CREDIT_CARD'))`,
  );
  await knex.raw(
    `ALTER TABLE pet_owner_store_orders ADD CONSTRAINT chk_pos_orders_payment_status
       CHECK (payment_status IN ('UNPAID', 'PAID', 'REFUNDED'))`,
  );
  await knex.raw(
    `ALTER TABLE pet_owner_store_orders ADD CONSTRAINT chk_pos_orders_amounts
       CHECK (subtotal_amount >= 0 AND delivery_fee >= 0 AND total_amount >= 0)`,
  );

  await knex.schema.createTable('pet_owner_store_order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id')
      .notNullable()
      .references('id')
      .inTable('pet_owner_store_orders')
      .onDelete('CASCADE');
    t.uuid('product_id')
      .nullable()
      .references('id')
      .inTable('pet_owner_store_products')
      .onDelete('SET NULL');
    t.text('product_name_snapshot').notNullable();
    t.decimal('unit_price', 12, 2).notNullable();
    t.integer('quantity').notNullable();
    t.decimal('line_total', 12, 2).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('order_id', 'idx_pos_order_items_order');
  });
  await knex.raw(
    `ALTER TABLE pet_owner_store_order_items ADD CONSTRAINT chk_pos_order_items_qty CHECK (quantity > 0)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pet_owner_store_order_items');
  await knex.schema.dropTableIfExists('pet_owner_store_orders');
  await knex.schema.dropTableIfExists('pet_owner_store_cart_items');
  await knex.schema.dropTableIfExists('pet_owner_store_carts');
  await knex.schema.dropTableIfExists('pet_owner_store_product_images');
  await knex.schema.dropTableIfExists('pet_owner_store_products');
  await knex.schema.dropTableIfExists('pet_owner_store_categories');
}
