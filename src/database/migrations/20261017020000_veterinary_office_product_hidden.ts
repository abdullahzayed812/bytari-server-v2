import type { Knex } from 'knex';

/**
 * "إخفاء/إظهار" (hide/show) — orthogonal to `status` (`ACTIVE`/`INACTIVE`, where `INACTIVE`
 * remains the "حذف" soft-delete state, unchanged). A hidden product stays ACTIVE and still
 * counts toward the owner's product stats; it is just excluded from the public catalog and
 * from the dashboard's default product list (shown instead on its own "Hidden products" screen).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinary_office_products', (t) => {
    t.boolean('is_hidden').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('veterinary_office_products', (t) => {
    t.index(['organization_id', 'is_hidden'], 'idx_vop_org_hidden');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinary_office_products', (t) => {
    t.dropIndex(['organization_id', 'is_hidden'], 'idx_vop_org_hidden');
    t.dropColumn('is_hidden');
  });
}
