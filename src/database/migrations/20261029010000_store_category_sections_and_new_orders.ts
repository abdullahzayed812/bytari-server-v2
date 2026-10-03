import type { Knex } from 'knex';

/**
 * Additional corrections §6 — Pet Owners Store + Veterinarian Store:
 *
 * 1. Category SECTIONS: `parent_id` makes a top-level category a section
 *    (e.g. «الحيوانات الأليفة») and its children sub-categories («أدوية»،
 *    «مكملات غذائية»، «إكسسوارات»). Two levels only (enforced in the service).
 *    Deleting a section is refused while it has sub-categories (RESTRICT).
 * 2. "New orders" badge: `admin_viewed_at` — NULL until a store manager opens
 *    the order or changes its status. Existing orders are backfilled as seen
 *    so the counter starts from zero instead of flagging history.
 */
const STORES = ['pet_owner_store', 'veterinarian_store'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const s of STORES) {
    await knex.schema.alterTable(`${s}_categories`, (t) => {
      t.uuid('parent_id')
        .nullable()
        .references('id')
        .inTable(`${s}_categories`)
        .onDelete('RESTRICT');
      t.index(['parent_id'], `idx_${s}_categories_parent`);
    });
    await knex.raw(
      `ALTER TABLE ${s}_categories ADD CONSTRAINT chk_${s}_categories_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id)`,
    );

    await knex.schema.alterTable(`${s}_orders`, (t) => {
      t.timestamp('admin_viewed_at', { useTz: true }).nullable();
    });
    await knex(`${s}_orders`).update({ admin_viewed_at: knex.ref('placed_at') });
    await knex.raw(
      `CREATE INDEX idx_${s}_orders_unviewed ON ${s}_orders (placed_at) WHERE admin_viewed_at IS NULL`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const s of STORES) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${s}_orders_unviewed`);
    await knex.schema.alterTable(`${s}_orders`, (t) => {
      t.dropColumn('admin_viewed_at');
    });
    await knex.raw(
      `ALTER TABLE ${s}_categories DROP CONSTRAINT IF EXISTS chk_${s}_categories_parent_not_self`,
    );
    await knex.schema.alterTable(`${s}_categories`, (t) => {
      t.dropIndex(['parent_id'], `idx_${s}_categories_parent`);
      t.dropColumn('parent_id');
    });
  }
}
