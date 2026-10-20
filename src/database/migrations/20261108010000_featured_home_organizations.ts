import type { Knex } from 'knex';

/**
 * Admin-curated clinics / veterinary offices shown in the home-page carousel
 * ("العيادات والمكاتب المميزة"). Each row references an EXISTING organization
 * (never a copy of it) on one home page, with a visibility window and an
 * on/off switch:
 *
 *   visible ⇔ is_enabled AND starts_on <= today <= ends_on (business date)
 *             AND the organization is still publicly visible (ACTIVE, CLINIC /
 *             VETERINARY_OFFICE, subscription not expired — checked at read time).
 *
 * One entry per (organization, page). The organization TYPE rule lives in the
 * service (a CHECK cannot look at another table); deleting the organization
 * removes its entries.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('featured_home_organizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.text('placement').notNullable();
    t.date('starts_on').notNullable();
    t.date('ends_on').notNullable();
    t.boolean('is_enabled').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['organization_id', 'placement'], { indexName: 'uq_featured_home_org_placement' });
    t.index(['placement', 'is_enabled', 'starts_on', 'ends_on'], 'idx_featured_home_org_visible');
  });
  await knex.raw(
    `ALTER TABLE featured_home_organizations
       ADD CONSTRAINT chk_featured_home_org_placement
         CHECK (placement IN ('PET_OWNER_HOME', 'VETERINARIAN_HOME')),
       ADD CONSTRAINT chk_featured_home_org_window CHECK (ends_on >= starts_on),
       ADD CONSTRAINT chk_featured_home_org_sort CHECK (sort_order BETWEEN 0 AND 9999)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('featured_home_organizations');
}
