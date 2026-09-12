import type { Knex } from 'knex';

/**
 * Veterinarian Store — a platform-run consumer storefront for Veterinarian-mode
 * users, mirroring the Pet Owners Store (`pet_owner_store_*`) but with its own
 * dedicated tables. Completely separate from:
 *   - `pet_owner_store_products` (Pet Owner mode's storefront)
 *   - `veterinary_store_products` (org-scoped catalogue owned by a VETERINARY_STORE
 *     organization)
 *   - `veterinary_office_products` (org-scoped catalogue owned by a VETERINARY_OFFICE
 *     organization)
 * The generic commerce *logic* (re-pricing, stock decrement, totals, order
 * state machine) lives in
 * `modules/veterinarian-store/domain/veterinarian-store.policy.ts`, mirroring
 * `pet-owner-store.policy.ts`'s store-agnostic shape.
 *
 * Tables:
 *   veterinarian_store_categories       — filter/classification labels (+ home tiles)
 *   veterinarian_store_products         — the catalogue
 *   veterinarian_store_product_images   — ordered gallery (primary mirrored on product)
 *   veterinarian_store_carts            — one active cart per user
 *   veterinarian_store_cart_items       — cart lines
 *   veterinarian_store_orders           — placed orders (COD only for now)
 *   veterinarian_store_order_items      — immutable order lines (price/name snapshot)
 *
 * Money: PostgreSQL `numeric` (never float). `pg` returns it as a string.
 * Product images are R2 object keys only — no binaries, no storage secrets.
 */
export async function up(knex: Knex): Promise<void> {
  // --- categories --------------------------------------------------------
  await knex.schema.createTable('veterinarian_store_categories', (t) => {
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
    `ALTER TABLE veterinarian_store_categories ADD CONSTRAINT chk_vts_categories_slug CHECK (slug ~ '^[a-z][a-z0-9-]{0,63}$')`,
  );
  await knex.raw(
    `ALTER TABLE veterinarian_store_categories ADD CONSTRAINT chk_vts_categories_status CHECK (status IN ('ACTIVE', 'INACTIVE'))`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_vts_categories_slug ON veterinarian_store_categories (slug)`,
  );

  // --- products --------------------------------------------------------
  await knex.schema.createTable('veterinarian_store_products', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('category_id')
      .nullable()
      .references('id')
      .inTable('veterinarian_store_categories')
      .onDelete('SET NULL');
    t.text('name').notNullable();
    t.text('description').nullable();
    t.decimal('price', 12, 2).notNullable();
    t.text('currency').notNullable().defaultTo('SAR');
    t.integer('stock_quantity').notNullable().defaultTo(0);
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.text('primary_image_key').nullable();
    /** Free-form spec chips shown on the details screen (الوزن / التركيز / القطيع المستهدف …). */
    t.jsonb('attributes').nullable();
    /** Display-only rating summary. No write path yet (columns reserved). */
    t.decimal('rating_average', 2, 1).nullable();
    t.integer('rating_count').notNullable().defaultTo(0);
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('status', 'idx_vts_products_status');
    t.index(['category_id', 'status'], 'idx_vts_products_category_status');
  });
  await knex.raw(
    `ALTER TABLE veterinarian_store_products ADD CONSTRAINT chk_vts_products_status CHECK (status IN ('ACTIVE', 'INACTIVE'))`,
  );
  await knex.raw(
    `ALTER TABLE veterinarian_store_products ADD CONSTRAINT chk_vts_products_price CHECK (price >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE veterinarian_store_products ADD CONSTRAINT chk_vts_products_stock CHECK (stock_quantity >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE veterinarian_store_products ADD CONSTRAINT chk_vts_products_rating CHECK (rating_average IS NULL OR (rating_average >= 0 AND rating_average <= 5))`,
  );
  await knex.raw(
    `CREATE INDEX idx_vts_products_name_lower ON veterinarian_store_products (lower(name))`,
  );

  // --- product images -------------------------------------------------
  await knex.schema.createTable('veterinarian_store_product_images', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('product_id')
      .notNullable()
      .references('id')
      .inTable('veterinarian_store_products')
      .onDelete('CASCADE');
    t.text('image_key').notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('product_id', 'idx_vts_product_images_product');
  });

  // --- carts --------------------------------------------------------
  await knex.schema.createTable('veterinarian_store_carts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`CREATE UNIQUE INDEX uq_vts_carts_user ON veterinarian_store_carts (user_id)`);

  await knex.schema.createTable('veterinarian_store_cart_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('cart_id')
      .notNullable()
      .references('id')
      .inTable('veterinarian_store_carts')
      .onDelete('CASCADE');
    t.uuid('product_id')
      .notNullable()
      .references('id')
      .inTable('veterinarian_store_products')
      .onDelete('RESTRICT');
    t.integer('quantity').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE veterinarian_store_cart_items ADD CONSTRAINT chk_vts_cart_items_qty CHECK (quantity > 0)`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_vts_cart_items_cart_product ON veterinarian_store_cart_items (cart_id, product_id)`,
  );

  // --- orders --------------------------------------------------------
  await knex.schema.createTable('veterinarian_store_orders', (t) => {
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

    t.index(['user_id', 'placed_at'], 'idx_vts_orders_user_placed');
    t.index('status', 'idx_vts_orders_status');
  });
  await knex.raw(
    `CREATE UNIQUE INDEX uq_vts_orders_number ON veterinarian_store_orders (order_number)`,
  );
  await knex.raw(
    `ALTER TABLE veterinarian_store_orders ADD CONSTRAINT chk_vts_orders_status
       CHECK (status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'))`,
  );
  await knex.raw(
    `ALTER TABLE veterinarian_store_orders ADD CONSTRAINT chk_vts_orders_payment_method
       CHECK (payment_method IN ('COD', 'MADA', 'CREDIT_CARD'))`,
  );
  await knex.raw(
    `ALTER TABLE veterinarian_store_orders ADD CONSTRAINT chk_vts_orders_payment_status
       CHECK (payment_status IN ('UNPAID', 'PAID', 'REFUNDED'))`,
  );
  await knex.raw(
    `ALTER TABLE veterinarian_store_orders ADD CONSTRAINT chk_vts_orders_amounts
       CHECK (subtotal_amount >= 0 AND delivery_fee >= 0 AND total_amount >= 0)`,
  );

  await knex.schema.createTable('veterinarian_store_order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id')
      .notNullable()
      .references('id')
      .inTable('veterinarian_store_orders')
      .onDelete('CASCADE');
    t.uuid('product_id')
      .nullable()
      .references('id')
      .inTable('veterinarian_store_products')
      .onDelete('SET NULL');
    t.text('product_name_snapshot').notNullable();
    t.decimal('unit_price', 12, 2).notNullable();
    t.integer('quantity').notNullable();
    t.decimal('line_total', 12, 2).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('order_id', 'idx_vts_order_items_order');
  });
  await knex.raw(
    `ALTER TABLE veterinarian_store_order_items ADD CONSTRAINT chk_vts_order_items_qty CHECK (quantity > 0)`,
  );

  // `chk_supervisor_domain` (system_supervisor_assignments) and
  // `chk_ad_campaigns_placement` (ad_campaigns) were ALSO widened in place in
  // their defining migrations (20260826050000, 20260908030000) to add
  // 'VETERINARIAN_STORE', matching how 'PET_OWNER_STORE' was added. That
  // in-place edit only takes effect for a fresh database, though — an
  // environment where those migrations already ran keeps the old constraint
  // text regardless of the source file, so re-apply it here too (idempotent:
  // harmless no-op if the in-place edit is what actually created it).
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT IF EXISTS chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (
        'ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY',
        'SUPPORT', 'ADVERTISEMENT', 'MARKET', 'PET_OWNER_STORE', 'VET_SERVICE',
        'VETERINARIAN_STORE'
      ))
  `);
  await knex.raw(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS chk_ad_campaigns_placement`);
  await knex.raw(`
    ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
      CHECK (placement IN (
        'HOME', 'PETS', 'POULTRY_FARMS', 'CLINICS', 'VETERINARY_OFFICES',
        'VETERINARY_STORES', 'PET_OWNER_STORE', 'VETERINARIAN_STORE', 'CONSULTATIONS', 'COURSES',
        'SEMINARS', 'POULTRY_MARKET', 'EGG_MARKET', 'EXCHANGE_RATES',
        'TRADER_REGISTRATION', 'SHEEP_FARMS', 'CATTLE_FARMS', 'VETERINARIAN_HOME'
      ))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS chk_ad_campaigns_placement`);
  await knex.raw(`
    ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
      CHECK (placement IN (
        'HOME', 'PETS', 'POULTRY_FARMS', 'CLINICS', 'VETERINARY_OFFICES',
        'VETERINARY_STORES', 'PET_OWNER_STORE', 'CONSULTATIONS', 'COURSES',
        'SEMINARS', 'POULTRY_MARKET', 'EGG_MARKET', 'EXCHANGE_RATES',
        'TRADER_REGISTRATION', 'SHEEP_FARMS', 'CATTLE_FARMS', 'VETERINARIAN_HOME'
      ))
  `);
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT IF EXISTS chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (
        'ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY',
        'SUPPORT', 'ADVERTISEMENT', 'MARKET', 'PET_OWNER_STORE', 'VET_SERVICE'
      ))
  `);
  await knex.schema.dropTableIfExists('veterinarian_store_order_items');
  await knex.schema.dropTableIfExists('veterinarian_store_orders');
  await knex.schema.dropTableIfExists('veterinarian_store_cart_items');
  await knex.schema.dropTableIfExists('veterinarian_store_carts');
  await knex.schema.dropTableIfExists('veterinarian_store_product_images');
  await knex.schema.dropTableIfExists('veterinarian_store_products');
  await knex.schema.dropTableIfExists('veterinarian_store_categories');
}
