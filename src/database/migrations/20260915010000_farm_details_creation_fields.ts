import type { Knex } from 'knex';

/**
 * "Add Poultry Farm" form fields for `farm_details`. The creation form (its own
 * domain-specific screen — the user never sees "create organization") captures
 * a short display location, a governorate, a current bird count, and the three
 * contact fields. `address` (detailed address), `capacity` (max birds),
 * `farm_category` (production type) and `image_key` (farm photo) already exist
 * from `20260912010000_poultry_operations.ts` and are reused as-is.
 *
 * Everything is written in the SAME transaction as the organization + owner
 * membership by `OrganizationService.create` (via `insertDetails`), so a failed
 * creation leaves no orphaned `organizations` / `farm_details` row.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('farm_details', (t) => {
    t.text('location').nullable();
    t.text('governorate').nullable();
    t.integer('current_bird_count').nullable();
    t.text('contact_name').nullable();
    t.text('contact_phone').nullable();
    t.text('contact_email').nullable();
  });
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_current_bird_count
       CHECK (current_bird_count IS NULL OR current_bird_count >= 0)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE farm_details DROP CONSTRAINT IF EXISTS chk_farm_details_current_bird_count`,
  );
  await knex.schema.alterTable('farm_details', (t) => {
    t.dropColumn('location');
    t.dropColumn('governorate');
    t.dropColumn('current_bird_count');
    t.dropColumn('contact_name');
    t.dropColumn('contact_phone');
    t.dropColumn('contact_email');
  });
}
