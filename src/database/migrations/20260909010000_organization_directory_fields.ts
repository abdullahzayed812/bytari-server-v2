import type { Knex } from 'knex';

/**
 * Extends the CLINIC / VETERINARY_OFFICE / VETERINARY_STORE directory profile
 * (`20260908010000_organization_profile_fields.ts`) with the fields the Pet
 * Owner Clinic Details screen needs: working hours, a services list, extra
 * contact channels (email / WhatsApp / social links) and a photo gallery.
 *
 * Same "extension point" tables as before — no PostGIS, no new concepts, just
 * more nullable columns on the existing `*_details` rows. `gallery_keys`
 * mirrors `logo_key` (R2 storage keys, resolved to URLs by the service layer)
 * but is an array — a clinic can have several photos, one logo.
 */
const PROFILE_TABLES = ['clinic_details', 'veterinary_office_details', 'veterinary_store_details'];

export async function up(knex: Knex): Promise<void> {
  for (const table of PROFILE_TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.text('working_hours').nullable();
      t.specificType('services', 'text[]').nullable();
      t.text('email').nullable();
      t.text('whatsapp').nullable();
      t.text('instagram_url').nullable();
      t.text('facebook_url').nullable();
      t.text('tiktok_url').nullable();
      t.specificType('gallery_keys', 'text[]').notNullable().defaultTo('{}');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of PROFILE_TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('working_hours');
      t.dropColumn('services');
      t.dropColumn('email');
      t.dropColumn('whatsapp');
      t.dropColumn('instagram_url');
      t.dropColumn('facebook_url');
      t.dropColumn('tiktok_url');
      t.dropColumn('gallery_keys');
    });
  }
}
