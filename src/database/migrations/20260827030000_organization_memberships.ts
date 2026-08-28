import type { Knex } from 'knex';

/**
 * Phase 3 — Organization memberships. The ONE model that represents every
 * organization relationship (owner, veterinarian, supervisor, staff).
 *
 * - `unique (organization_id, user_id)` — one membership row per user per org.
 *   Re-joining after LEFT/REMOVED re-activates that row (no second row).
 * - The owner is stored here as an OWNER membership *in addition to*
 *   `organizations.owner_user_id`.
 * - Independence: removing a user from one organization does not touch their
 *   membership in any other.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organization_memberships', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('organization_role_id')
      .notNullable()
      .references('id')
      .inTable('organization_roles')
      .onDelete('RESTRICT');
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.uuid('added_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['organization_id', 'user_id'], { indexName: 'uq_org_membership_user' });
    t.index('user_id', 'idx_org_memberships_user');
    t.index(['organization_id', 'status'], 'idx_org_memberships_org_status');
    t.index(['organization_id', 'organization_role_id'], 'idx_org_memberships_org_role');
  });

  await knex.raw(`
    ALTER TABLE organization_memberships
      ADD CONSTRAINT chk_org_membership_status
      CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED', 'LEFT'))
  `);

  // Per-supervisor selected permissions (only meaningful for SUPERVISOR members).
  await knex.schema.createTable('organization_supervisor_permissions', (t) => {
    t.uuid('membership_id')
      .notNullable()
      .references('id')
      .inTable('organization_memberships')
      .onDelete('CASCADE');
    t.uuid('organization_permission_id')
      .notNullable()
      .references('id')
      .inTable('organization_permissions')
      .onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['membership_id', 'organization_permission_id']);
    t.index('organization_permission_id', 'idx_org_supervisor_permissions_permission');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('organization_supervisor_permissions');
  await knex.schema.dropTableIfExists('organization_memberships');
}
