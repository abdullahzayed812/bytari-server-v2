import type { Knex } from 'knex';

/**
 * Adoption / mating / lost listings are NOT the owner's registered pets.
 *
 * The listing flow ("إضافة إعلان تبني / تزاوج / مفقود") has to create an
 * `animals` row (a publication always points at one), but that row is a
 * listing subject only: `listing_only = true` keeps it out of the owner's
 * "حيواناتي" list and pet pickers, while ownership (who may edit / publish it)
 * is unchanged.
 *
 * Backfill — conservative, so no legitimate pet is ever hidden: only an animal
 * created by the listing flow shape — its first publication was created
 * within 2 minutes of the animal itself — and never used as a pet (no medical
 * record, vaccination, clinic access, appointment, consultation or transfer).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('animals', (t) => {
    t.boolean('listing_only').notNullable().defaultTo(false);
  });
  await knex.raw(`
    UPDATE animals a
       SET listing_only = true
     WHERE EXISTS (
             SELECT 1 FROM animal_publications p
              WHERE p.animal_id = a.id
                AND p.created_at >= a.created_at
                AND p.created_at <= a.created_at + interval '2 minutes'
           )
       AND NOT EXISTS (SELECT 1 FROM medical_records m WHERE m.animal_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM vaccinations v WHERE v.animal_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM animal_clinic_access c WHERE c.animal_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM clinic_appointments ca WHERE ca.animal_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM consultations co WHERE co.animal_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM animal_transfer_requests tr WHERE tr.animal_id = a.id)
  `);
  await knex.raw(
    'CREATE INDEX idx_animals_listing_only ON animals (listing_only) WHERE listing_only = false',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_animals_listing_only');
  await knex.schema.alterTable('animals', (t) => {
    t.dropColumn('listing_only');
  });
}
