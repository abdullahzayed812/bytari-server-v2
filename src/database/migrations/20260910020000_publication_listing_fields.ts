import type { Knex } from 'knex';

/**
 * Extends `animal_publications` with the per-listing fields the Lost /
 * Adoption / Mating reference designs need. The Phase 7 migration deliberately
 * left the table minimal ("the spec defines no type-specific fields") — the
 * spec has since grown one: each kind now shows a different field set on its
 * detail/create screen, so those fields land here, not on `animals` (they are
 * claims made AT LISTING TIME, e.g. this listing's health status, not a
 * permanent fact about the animal — the same animal could be re-listed later
 * with an updated claim).
 *
 * `contact_name` / `contact_phone` are genuinely new, explicit, per-listing
 * contact info the owner opts to publish with THIS listing — never the
 * account's private phone. This supersedes the Phase 7 design note that the
 * public DTO carries no contact field: the reference design shows the phone
 * number directly, so exposing this explicit, purpose-collected field is the
 * intended behavior now (unlike leaking `users.phone`).
 *
 * Column groups:
 *   - always required (any kind): contact_name, contact_phone
 *   - ADOPTION / MATING: city, health_status, vaccination_status
 *   - ADOPTION only: is_sterilized
 *   - LOST only: lost_date, lost_time, lost_governorate, lost_district,
 *     lost_location_detail, health_notes (freeform — distinct from the
 *     ADOPTION/MATING `health_status` enum)
 *   - any kind, optional: extra_notes (a second free-text field alongside the
 *     existing `note`, which now doubles as "الوصف/معلومات إضافية")
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('animal_publications', (t) => {
    t.text('contact_name').nullable();
    t.text('contact_phone').nullable();
    t.text('city').nullable();
    t.text('extra_notes').nullable();
    t.text('health_status').nullable();
    t.text('vaccination_status').nullable();
    t.boolean('is_sterilized').nullable();
    t.date('lost_date').nullable();
    t.time('lost_time').nullable();
    t.text('lost_governorate').nullable();
    t.text('lost_district').nullable();
    t.text('lost_location_detail').nullable();
    t.text('health_notes').nullable();
  });

  // Contact info is mandatory for every listing regardless of kind.
  await knex.raw(`
    ALTER TABLE animal_publications
      ALTER COLUMN contact_name SET NOT NULL,
      ALTER COLUMN contact_phone SET NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_health_status
      CHECK (health_status IS NULL OR health_status IN ('EXCELLENT', 'GOOD', 'FAIR', 'POOR'))
  `);
  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_vaccination_status
      CHECK (vaccination_status IS NULL OR vaccination_status IN ('COMPLETE', 'PARTIAL', 'NONE'))
  `);
  // LOST-only fields must stay empty for any other kind.
  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_lost_only_fields
      CHECK (
        kind = 'LOST'
        OR (lost_date IS NULL AND lost_time IS NULL AND lost_governorate IS NULL
            AND lost_district IS NULL AND lost_location_detail IS NULL AND health_notes IS NULL)
      )
  `);
  // LOST requires when/where it went missing.
  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_lost_required_fields
      CHECK (
        kind <> 'LOST'
        OR (lost_date IS NOT NULL AND lost_governorate IS NOT NULL AND lost_district IS NOT NULL)
      )
  `);
  // ADOPTION / MATING require city + the two status fields.
  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_status_fields_required
      CHECK (
        kind = 'LOST'
        OR (city IS NOT NULL AND health_status IS NOT NULL AND vaccination_status IS NOT NULL)
      )
  `);
  // `is_sterilized` only applies to ADOPTION.
  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_sterilized_adoption_only
      CHECK (kind = 'ADOPTION' OR is_sterilized IS NULL)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_sterilized_adoption_only',
  );
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_status_fields_required',
  );
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_lost_required_fields',
  );
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_lost_only_fields',
  );
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_vaccination_status',
  );
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_health_status',
  );
  await knex.schema.alterTable('animal_publications', (t) => {
    t.dropColumn('contact_name');
    t.dropColumn('contact_phone');
    t.dropColumn('city');
    t.dropColumn('extra_notes');
    t.dropColumn('health_status');
    t.dropColumn('vaccination_status');
    t.dropColumn('is_sterilized');
    t.dropColumn('lost_date');
    t.dropColumn('lost_time');
    t.dropColumn('lost_governorate');
    t.dropColumn('lost_district');
    t.dropColumn('lost_location_detail');
    t.dropColumn('health_notes');
  });
}
