import type { Knex } from 'knex';

/**
 * Phase 3 — Organization RBAC, kept CONCEPTUALLY SEPARATE from the global RBAC
 * of Phase 2:
 *
 *   organization_roles ──< organization_role_permissions >── organization_permissions
 *
 * A member's effective organization permissions = the permissions of their
 * organization_role, plus (for SUPERVISOR members) an explicitly selected set
 * stored per-membership in `organization_supervisor_permissions` (later migration).
 *
 * Also relaxes the global `permissions.key` CHECK from exactly two segments to
 * two-or-more, so global keys like `organization.admin.approve` are allowed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE permissions DROP CONSTRAINT IF EXISTS chk_permissions_key`);
  await knex.raw(
    `ALTER TABLE permissions ADD CONSTRAINT chk_permissions_key CHECK (key ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$')`,
  );

  await knex.schema.createTable('organization_roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('key').notNullable().unique();
    t.text('name').notNullable();
    t.text('description').nullable();
    t.boolean('is_system').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE organization_roles ADD CONSTRAINT chk_organization_roles_key CHECK (key ~ '^[A-Z][A-Z0-9_]*$')`,
  );

  await knex.schema.createTable('organization_permissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('key').notNullable().unique();
    t.text('description').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE organization_permissions ADD CONSTRAINT chk_organization_permissions_key CHECK (key ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$')`,
  );

  await knex.schema.createTable('organization_role_permissions', (t) => {
    t.uuid('organization_role_id')
      .notNullable()
      .references('id')
      .inTable('organization_roles')
      .onDelete('CASCADE');
    t.uuid('organization_permission_id')
      .notNullable()
      .references('id')
      .inTable('organization_permissions')
      .onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['organization_role_id', 'organization_permission_id']);
    t.index('organization_permission_id', 'idx_org_role_permissions_permission');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('organization_role_permissions');
  await knex.schema.dropTableIfExists('organization_permissions');
  await knex.schema.dropTableIfExists('organization_roles');
  await knex.raw(`ALTER TABLE permissions DROP CONSTRAINT IF EXISTS chk_permissions_key`);
  await knex.raw(
    `ALTER TABLE permissions ADD CONSTRAINT chk_permissions_key CHECK (key ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$')`,
  );
}
