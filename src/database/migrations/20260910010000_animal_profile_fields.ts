import type { Knex } from 'knex';

/**
 * Extends the Animal Core with the descriptive fields the Lost / Adoption /
 * Mating listing forms need to collect about the animal itself: `color`,
 * `distinguishing_features` (physical description — helps identify a lost
 * animal, but is a property of the animal, not the listing), `age_estimate`
 * (a controlled label for when the exact `date_of_birth` isn't known — common
 * for a found/rescued animal), and `gallery_keys` (R2 storage keys, same
 * array-of-keys pattern already used for the organization gallery).
 *
 * Deliberately on `animals`, not `animal_publications` — these describe the
 * animal and stay true across any future listing of it, so they belong with
 * `name` / `species` / `breed` / `sex`, not duplicated per listing.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('animals', (t) => {
    t.text('color').nullable();
    t.text('distinguishing_features').nullable();
    t.text('age_estimate').nullable();
    t.specificType('gallery_keys', 'text[]').notNullable().defaultTo('{}');
  });

  await knex.raw(`
    ALTER TABLE animals
      ADD CONSTRAINT chk_animals_age_estimate
      CHECK (age_estimate IS NULL OR age_estimate IN ('UNDER_1_YEAR', 'ONE_TO_3_YEARS', 'THREE_TO_7_YEARS', 'OVER_7_YEARS'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE animals DROP CONSTRAINT IF EXISTS chk_animals_age_estimate');
  await knex.schema.alterTable('animals', (t) => {
    t.dropColumn('color');
    t.dropColumn('distinguishing_features');
    t.dropColumn('age_estimate');
    t.dropColumn('gallery_keys');
  });
}
