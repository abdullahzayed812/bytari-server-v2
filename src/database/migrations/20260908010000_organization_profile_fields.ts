import type { Knex } from 'knex';

/**
 * Public directory profile fields for CLINIC / VETERINARY_OFFICE /
 * VETERINARY_STORE — the Pet Owner marketplace pages need an address, a
 * location to sort "nearest" by, a contact number and a logo.
 *
 * These land on each type's existing "extension point" detail table
 * (`clinic_details`, `veterinary_office_details`, `veterinary_store_details`
 * — created empty in `20260827010000_organizations.ts` for exactly this),
 * not on the shared `organizations` table — the same reasoning `farm_details`
 * already follows for `join_code`. FARM is untouched: it isn't part of this
 * directory and keeps only `join_code`.
 *
 * No PostGIS — the current data volume doesn't need it; distance is computed
 * with a plain SQL haversine expression at query time (see
 * `organization.repository.ts#discoverWithDetails`).
 */
const PROFILE_TABLES = ['clinic_details', 'veterinary_office_details', 'veterinary_store_details'];

export async function up(knex: Knex): Promise<void> {
  for (const table of PROFILE_TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.text('address').nullable();
      t.double('latitude').nullable();
      t.double('longitude').nullable();
      t.text('phone').nullable();
      t.text('logo_key').nullable();
    });
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90)
    `);
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
    `);
    // Both-or-neither — a lone coordinate can't be distance-sorted anyway.
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_coords_pair
        CHECK ((latitude IS NULL) = (longitude IS NULL))
    `);
    await knex.raw(`
      CREATE INDEX idx_${table}_coords ON ${table} (latitude, longitude)
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of PROFILE_TABLES) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_coords`);
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_coords_pair`);
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_longitude`);
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_latitude`);
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('address');
      t.dropColumn('latitude');
      t.dropColumn('longitude');
      t.dropColumn('phone');
      t.dropColumn('logo_key');
    });
  }
}
