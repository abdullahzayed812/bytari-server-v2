import type { Knex } from 'knex';

/**
 * Organization stores (Clinic Store + Veterinary Office Store) — cart,
 * checkout, orders, order tracking.
 *
 *   organization_store_carts         — one cart per (shopper, organization)
 *   organization_store_cart_items    — lines → `veterinary_office_products`
 *   organization_store_orders        — placed orders, always ONE organization
 *   organization_store_order_items   — immutable lines (name / price snapshot)
 *   organization_store_order_events  — append-only status history (tracking)
 *
 * Plus the org-RBAC permissions `store.order.read` / `store.order.manage`
 * (granted to no role by default — OWNER override, ADMIN, or an explicit
 * per-membership supervisor grant). The org RBAC seed inserts the same keys on
 * a fresh database; idempotent.
 *
 * Orders are the customer's purchase history, so the organization FK is
 * RESTRICT (an organization holding orders is never permanently purged — it
 * stays soft-deleted, like one holding pet owners' records). Carts are
 * disposable and CASCADE.
 */
const STATUSES = `('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED')`;

const PERMISSIONS = [
  { key: 'store.order.read', description: 'View this clinic/office store’s incoming orders' },
  {
    key: 'store.order.manage',
    description: 'Confirm, process, ship, deliver or cancel this clinic/office store’s orders',
  },
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organization_store_carts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'organization_id'], { indexName: 'uq_osc_user_org' });
  });

  await knex.schema.createTable('organization_store_cart_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('cart_id')
      .notNullable()
      .references('id')
      .inTable('organization_store_carts')
      .onDelete('CASCADE');
    t.uuid('product_id')
      .notNullable()
      .references('id')
      .inTable('veterinary_office_products')
      .onDelete('CASCADE');
    t.integer('quantity').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['cart_id', 'product_id'], { indexName: 'uq_osci_cart_product' });
  });
  await knex.raw(
    `ALTER TABLE organization_store_cart_items ADD CONSTRAINT chk_osci_qty CHECK (quantity > 0 AND quantity <= 99)`,
  );

  await knex.schema.createTable('organization_store_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('order_number').notNullable();
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('RESTRICT');
    /** Snapshot of the seller's type at checkout (CLINIC | VETERINARY_OFFICE). */
    t.text('organization_type').notNullable();
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('payment_method').notNullable();
    t.text('payment_status').notNullable().defaultTo('UNPAID');
    t.decimal('subtotal_amount', 12, 2).notNullable();
    t.decimal('delivery_fee', 12, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 12, 2).notNullable();
    t.text('currency').notNullable();
    t.text('recipient_name').notNullable();
    t.text('recipient_phone').notNullable();
    t.text('city').notNullable();
    t.text('address_line').notNullable();
    t.text('note').nullable();
    /** First time a seller-side member opened / acted on it ("new" badge). */
    t.timestamp('seller_viewed_at', { useTz: true }).nullable();
    t.timestamp('placed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['organization_id', 'placed_at'], 'idx_oso_org_placed');
    t.index(['user_id', 'placed_at'], 'idx_oso_user_placed');
  });
  await knex.raw(
    `CREATE UNIQUE INDEX uq_oso_order_number ON organization_store_orders (order_number)`,
  );
  await knex.raw(
    `ALTER TABLE organization_store_orders ADD CONSTRAINT chk_oso_status CHECK (status IN ${STATUSES})`,
  );
  await knex.raw(
    `ALTER TABLE organization_store_orders ADD CONSTRAINT chk_oso_org_type
       CHECK (organization_type IN ('CLINIC', 'VETERINARY_OFFICE'))`,
  );
  await knex.raw(
    `ALTER TABLE organization_store_orders ADD CONSTRAINT chk_oso_payment_method
       CHECK (payment_method IN ('COD'))`,
  );
  await knex.raw(
    `ALTER TABLE organization_store_orders ADD CONSTRAINT chk_oso_payment_status
       CHECK (payment_status IN ('UNPAID', 'PAID', 'REFUNDED'))`,
  );
  await knex.raw(
    `ALTER TABLE organization_store_orders ADD CONSTRAINT chk_oso_currency CHECK (currency IN ('IQD', 'USD'))`,
  );
  await knex.raw(
    `ALTER TABLE organization_store_orders ADD CONSTRAINT chk_oso_amounts
       CHECK (subtotal_amount >= 0 AND delivery_fee >= 0 AND total_amount >= 0)`,
  );

  await knex.schema.createTable('organization_store_order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id')
      .notNullable()
      .references('id')
      .inTable('organization_store_orders')
      .onDelete('CASCADE');
    t.uuid('product_id')
      .nullable()
      .references('id')
      .inTable('veterinary_office_products')
      .onDelete('SET NULL');
    t.text('product_name_snapshot').notNullable();
    t.decimal('unit_price', 12, 2).notNullable();
    t.integer('quantity').notNullable();
    t.decimal('line_total', 12, 2).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('order_id', 'idx_osoi_order');
  });
  await knex.raw(
    `ALTER TABLE organization_store_order_items ADD CONSTRAINT chk_osoi_qty CHECK (quantity > 0)`,
  );

  await knex.schema.createTable('organization_store_order_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('order_id')
      .notNullable()
      .references('id')
      .inTable('organization_store_orders')
      .onDelete('CASCADE');
    t.text('from_status').nullable();
    t.text('to_status').notNullable();
    t.uuid('actor_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    /** CUSTOMER | SELLER — which side made the change. */
    t.text('actor_side').notNullable();
    t.text('note').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['order_id', 'created_at'], 'idx_osoe_order');
  });
  await knex.raw(
    `ALTER TABLE organization_store_order_events ADD CONSTRAINT chk_osoe_to_status CHECK (to_status IN ${STATUSES})`,
  );
  await knex.raw(
    `ALTER TABLE organization_store_order_events ADD CONSTRAINT chk_osoe_side
       CHECK (actor_side IN ('CUSTOMER', 'SELLER'))`,
  );

  for (const p of PERMISSIONS) {
    await knex('organization_permissions')
      .insert(p)
      .onConflict('key')
      .merge({ description: p.description, updated_at: knex.fn.now() });
  }
}

export async function down(knex: Knex): Promise<void> {
  const perms = await knex('organization_permissions')
    .whereIn(
      'key',
      PERMISSIONS.map((p) => p.key),
    )
    .select('id');
  const ids = perms.map((p: { id: string }) => p.id);
  if (ids.length > 0) {
    await knex('organization_supervisor_permissions')
      .whereIn('organization_permission_id', ids)
      .delete();
    await knex('organization_role_permissions').whereIn('organization_permission_id', ids).delete();
    await knex('organization_permissions').whereIn('id', ids).delete();
  }
  await knex.schema.dropTableIfExists('organization_store_order_events');
  await knex.schema.dropTableIfExists('organization_store_order_items');
  await knex.schema.dropTableIfExists('organization_store_orders');
  await knex.schema.dropTableIfExists('organization_store_cart_items');
  await knex.schema.dropTableIfExists('organization_store_carts');
}
