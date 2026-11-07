import type { Knex } from 'knex';

/**
 * Poultry market advertisements state the birds' age in DAYS (was weeks):
 * `poultry_offers.age_weeks` → `age_days`, existing values converted ×7.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('poultry_offers', (t) => {
    t.integer('age_days').nullable();
  });
  await knex.raw('UPDATE poultry_offers SET age_days = age_weeks * 7 WHERE age_weeks IS NOT NULL');
  await knex.raw(
    'ALTER TABLE poultry_offers DROP CONSTRAINT IF EXISTS chk_poultry_offers_age_weeks',
  );
  await knex.schema.alterTable('poultry_offers', (t) => {
    t.dropColumn('age_weeks');
  });
  await knex.raw(`
    ALTER TABLE poultry_offers ADD CONSTRAINT chk_poultry_offers_age_days
      CHECK (age_days IS NULL OR age_days >= 0)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('poultry_offers', (t) => {
    t.integer('age_weeks').nullable();
  });
  await knex.raw(
    'UPDATE poultry_offers SET age_weeks = round(age_days / 7.0) WHERE age_days IS NOT NULL',
  );
  await knex.raw(
    'ALTER TABLE poultry_offers DROP CONSTRAINT IF EXISTS chk_poultry_offers_age_days',
  );
  await knex.schema.alterTable('poultry_offers', (t) => {
    t.dropColumn('age_days');
  });
  await knex.raw(`
    ALTER TABLE poultry_offers ADD CONSTRAINT chk_poultry_offers_age_weeks
      CHECK (age_weeks IS NULL OR age_weeks >= 0)
  `);
}
