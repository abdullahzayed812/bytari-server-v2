import type { Knex } from 'knex';

/**
 * Phase 2 — Authorization: database-backed roles & permissions.
 *
 *   users ──< user_roles >── roles ──< role_permissions >── permissions
 *
 * Roles/permissions are seeded (`0010_rbac` seed). `is_system` protects the
 * built-in roles from deletion. The model deliberately leaves room for
 * organisation-scoped grants later (a future `organization_id` column on a
 * separate membership/grant table) without touching these tables.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('key').notNullable().unique();
    t.text('name').notNullable();
    t.text('description').nullable();
    t.boolean('is_system').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE roles ADD CONSTRAINT chk_roles_key CHECK (key ~ '^[A-Z][A-Z0-9_]*$')`,
  );

  await knex.schema.createTable('permissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('key').notNullable().unique();
    t.text('description').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  // One or more dot-separated segments (e.g. `product.read`,
  // `product.inventory.adjust`) — widened from a single dot when
  // organization RBAC introduced multi-segment keys.
  await knex.raw(
    `ALTER TABLE permissions ADD CONSTRAINT chk_permissions_key CHECK (key ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$')`,
  );

  await knex.schema.createTable('role_permissions', (t) => {
    t.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.uuid('permission_id')
      .notNullable()
      .references('id')
      .inTable('permissions')
      .onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['role_id', 'permission_id']);
    t.index('permission_id', 'idx_role_permissions_permission');
  });

  await knex.schema.createTable('user_roles', (t) => {
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // RESTRICT: a role that is still assigned cannot be deleted.
    t.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('RESTRICT');
    t.uuid('assigned_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'role_id']);
    t.index('role_id', 'idx_user_roles_role');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
}
