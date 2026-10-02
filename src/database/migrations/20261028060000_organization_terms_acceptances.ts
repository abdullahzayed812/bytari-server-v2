import type { Knex } from 'knex';

/**
 * Registration Terms & Conditions acceptance (terms addendum): one row per
 * organization + terms set, written in the SAME transaction that creates the
 * organization — who accepted, which terms (`terms_key`), which wording
 * (`terms_version`, a content hash) and when. Admins see it on the application.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organization_terms_acceptances', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('terms_key').notNullable();
    t.text('terms_version').notNullable();
    t.timestamp('accepted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['organization_id', 'terms_key']);
  });
  await knex.raw(`
    ALTER TABLE organization_terms_acceptances ADD CONSTRAINT chk_org_terms_key
      CHECK (terms_key IN ('CLINIC', 'VETERINARY_OFFICE', 'POULTRY_FARM', 'SHEEP_FARM', 'CATTLE_FARM'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('organization_terms_acceptances');
}
