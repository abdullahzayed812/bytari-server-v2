import type { Knex } from 'knex';

/**
 * Clinic specialty + store controls (2026-11-04):
 *
 *  - `clinic_details.specialty` — "تخصص العيادة", free text. Required by the
 *    API for NEW clinic registrations; nullable here so clinics registered
 *    before this migration stay valid until they fill it in.
 *  - `clinic_details.store_enabled` — Admin switch for a clinic's store. OFF
 *    hides the catalogue and blocks every customer store call (browse, cart,
 *    checkout); products and past orders are kept untouched.
 *  - `clinic_details.orders_enabled` / `veterinary_office_details.orders_enabled`
 *    — the seller's own "receive new orders" switch. OFF blocks add-to-cart and
 *    checkout only; browsing and existing orders keep working.
 *
 * Both flags default to TRUE so every existing store keeps its current behaviour.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_details', (t) => {
    t.text('specialty').nullable();
    t.boolean('store_enabled').notNullable().defaultTo(true);
    t.boolean('orders_enabled').notNullable().defaultTo(true);
  });
  await knex.schema.alterTable('veterinary_office_details', (t) => {
    t.boolean('orders_enabled').notNullable().defaultTo(true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinary_office_details', (t) => {
    t.dropColumn('orders_enabled');
  });
  await knex.schema.alterTable('clinic_details', (t) => {
    t.dropColumn('orders_enabled');
    t.dropColumn('store_enabled');
    t.dropColumn('specialty');
  });
}
