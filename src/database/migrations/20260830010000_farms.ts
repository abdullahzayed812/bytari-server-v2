import type { Knex } from 'knex';

/**
 * Phase 6 — Farms & Poultry.
 *
 * The Farm domain reuses the Phase 3 organization aggregate (type `FARM`),
 * `organization_memberships`, `farm_details.join_code` and the organization RBAC.
 * This migration adds ONLY:
 *
 *   1. a `UNIQUE (id, type)` on `organizations` so child tables can prove — at
 *      the database level — that they reference a FARM (composite foreign key),
 *      not just some organization.
 *   2. `poultry_flocks` — the single confirmed poultry entity (a batch/flock of
 *      birds). Production / mortality / feed / health sub-entities are deliberate
 *      future extension points and are NOT modelled here (the spec defines no
 *      concrete fields for them).
 *
 * No new farm membership / ownership / role / permission tables — those already
 * exist from Phase 3.
 */
export async function up(knex: Knex): Promise<void> {
  // `id` is already the PK (unique); this named UNIQUE lets other tables target
  // `(id, type)` in a composite FK to pin the organization type.
  await knex.raw(
    `ALTER TABLE organizations ADD CONSTRAINT uq_organizations_id_type UNIQUE (id, type)`,
  );

  await knex.schema.createTable('poultry_flocks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable();
    // Denormalised, immutable, CHECK-pinned to 'FARM' and joined to
    // `organizations(id, type)` by the composite FK below — a poultry flock can
    // only ever reference a FARM organization.
    t.text('organization_type').notNullable().defaultTo('FARM');
    t.text('name').notNullable();
    t.text('bird_type').notNullable();
    t.integer('bird_count').notNullable();
    t.date('arrival_date').notNullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.text('notes').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_poultry_flocks_org');
    t.index(['organization_id', 'status'], 'idx_poultry_flocks_org_status');

    t.foreign(['organization_id', 'organization_type'], 'fk_poultry_flocks_farm')
      .references(['id', 'type'])
      .inTable('organizations')
      .onDelete('RESTRICT');
  });

  await knex.raw(
    `ALTER TABLE poultry_flocks ADD CONSTRAINT chk_poultry_flocks_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE poultry_flocks ADD CONSTRAINT chk_poultry_flocks_status CHECK (status IN ('ACTIVE', 'CLOSED'))`,
  );
  await knex.raw(
    `ALTER TABLE poultry_flocks ADD CONSTRAINT chk_poultry_flocks_bird_type
       CHECK (bird_type IN ('CHICKEN', 'DUCK', 'TURKEY', 'QUAIL', 'GOOSE', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE poultry_flocks ADD CONSTRAINT chk_poultry_flocks_bird_count CHECK (bird_count >= 0)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('poultry_flocks');
  await knex.raw(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS uq_organizations_id_type`);
}
