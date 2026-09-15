import type { Knex } from 'knex';

/**
 * Generalizes the Poultry Farm subscription window (`farm_details.subscription_*`,
 * `20260916010000_farm_subscription.ts`) to VETERINARY_OFFICE and CLINIC organizations —
 * required by the Veterinary Office Dashboard's approval/subscription concept (spec §3),
 * which explicitly reuses the Farm infrastructure rather than duplicating it.
 *
 * `farm_subscription_renewal_requests` is already keyed purely by `organization_id` (no
 * farm-specific column) so it is reused unchanged for these two org types — see
 * `FarmSubscriptionRenewalRepository`, which becomes organization-type-aware about which
 * `*_details` table to read/write dates from. `FarmSubscriptionService` needs no change.
 */
export async function up(knex: Knex): Promise<void> {
  for (const table of ['veterinary_office_details', 'clinic_details']) {
    await knex.schema.alterTable(table, (t) => {
      t.date('subscription_start_date').nullable();
      t.date('subscription_end_date').nullable();
    });
    await knex.raw(`
      ALTER TABLE ${table}
        ADD CONSTRAINT chk_${table}_subscription_dates
        CHECK (
          subscription_start_date IS NULL
          OR subscription_end_date IS NULL
          OR subscription_end_date >= subscription_start_date
        )
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of ['veterinary_office_details', 'clinic_details']) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_subscription_dates`);
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('subscription_start_date');
      t.dropColumn('subscription_end_date');
    });
  }
}
