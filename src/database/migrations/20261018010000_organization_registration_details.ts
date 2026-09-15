import type { Knex } from 'knex';

/**
 * Richer registration for CLINIC / VETERINARY_OFFICE organizations
 * ("تسجيل العيادة" / office registration screens): `country` (public profile
 * field, alongside `address`), plus `license_number` + `license_document_keys`
 * (owner/admin-only — never exposed on the public discover DTO, mirrors the
 * private veterinarian-application `LICENSE_OR_ID` document concept but at the
 * organization level, reviewed by an admin before approval). Same shape as the
 * existing `gallery_keys` column (a plain key array, resolved to URLs in the
 * application layer) — no new table needed.
 */
export async function up(knex: Knex): Promise<void> {
  // `website_url` / `country` on all 3 directory-profile types (alongside the
  // existing instagram/facebook/tiktok social links); `license_number` /
  // `license_document_keys` on CLINIC + VETERINARY_OFFICE only.
  for (const table of ['clinic_details', 'veterinary_office_details', 'veterinary_store_details']) {
    await knex.schema.alterTable(table, (t) => {
      t.text('website_url').nullable();
      t.text('country').nullable();
    });
  }
  for (const table of ['clinic_details', 'veterinary_office_details']) {
    await knex.schema.alterTable(table, (t) => {
      t.text('license_number').nullable();
      t.specificType('license_document_keys', 'text[]').notNullable().defaultTo('{}');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of ['clinic_details', 'veterinary_office_details', 'veterinary_store_details']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('website_url');
      t.dropColumn('country');
    });
  }
  for (const table of ['clinic_details', 'veterinary_office_details']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('license_number');
      t.dropColumn('license_document_keys');
    });
  }
}
