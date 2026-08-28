import type { Knex } from 'knex';

/**
 * Phase 3 — Organizations: the unified `organizations` aggregate plus thin
 * per-subtype detail tables.
 *
 *   organizations
 *       ├── clinic_details              (extension point — no confirmed fields yet)
 *       ├── farm_details                (join_code for the Farm-ID join flow)
 *       ├── veterinary_office_details   (extension point)
 *       └── veterinary_store_details    (extension point)
 *
 * Organizations are never physically deleted — the `status` lifecycle
 * (PENDING → ACTIVE / REJECTED / SUSPENDED / DEACTIVATED) governs access.
 * `owner_user_id` is `ON DELETE RESTRICT`: a user who owns organizations
 * cannot be removed. The owner is *also* represented in
 * `organization_memberships` (next migration) as an OWNER membership.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('type').notNullable();
    t.text('name').notNullable();
    t.text('description').nullable();
    t.uuid('owner_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('decided_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.text('decision_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('owner_user_id', 'idx_organizations_owner');
    t.index('status', 'idx_organizations_status');
    t.index(['type', 'status'], 'idx_organizations_type_status');
  });

  await knex.raw(`
    ALTER TABLE organizations
      ADD CONSTRAINT chk_organizations_type
      CHECK (type IN ('CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE'))
  `);
  await knex.raw(`
    ALTER TABLE organizations
      ADD CONSTRAINT chk_organizations_status
      CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'))
  `);

  const detailTable = async (
    name: string,
    extra?: (t: Knex.CreateTableBuilder) => void,
  ): Promise<void> => {
    await knex.schema.createTable(name, (t) => {
      t.uuid('organization_id')
        .primary()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE');
      extra?.(t);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  };

  await detailTable('clinic_details');
  await detailTable('farm_details', (t) => {
    // The "Farm ID" a veterinarian enters to join. The concrete join endpoint
    // is deferred (see spec §19) — only the identifier is provisioned now.
    t.text('join_code').notNullable().unique();
  });
  await detailTable('veterinary_office_details');
  await detailTable('veterinary_store_details');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('veterinary_store_details');
  await knex.schema.dropTableIfExists('veterinary_office_details');
  await knex.schema.dropTableIfExists('farm_details');
  await knex.schema.dropTableIfExists('clinic_details');
  await knex.schema.dropTableIfExists('organizations');
}
