import type { Knex } from 'knex';

/**
 * Poultry traders get a LIMITED activation period, like clinics / offices
 * (final corrections §8). Approval starts it (default one year); once
 * `subscription_end_date` passes, trader-only market access is blocked until an
 * admin renews it. `renewal_requested_at` = the trader asked for a renewal
 * (cleared when the admin sets a new period).
 *
 * Existing APPROVED / SUSPENDED traders get a one-year period starting today,
 * so nobody is locked out by the migration itself.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('trader_profiles', (t) => {
    t.date('subscription_start_date').nullable();
    t.date('subscription_end_date').nullable();
    t.timestamp('renewal_requested_at', { useTz: true }).nullable();
  });
  await knex.raw(`
    ALTER TABLE trader_profiles ADD CONSTRAINT chk_trader_profiles_subscription_period CHECK (
      (subscription_start_date IS NULL AND subscription_end_date IS NULL) OR
      (subscription_start_date IS NOT NULL AND subscription_end_date IS NOT NULL
        AND subscription_end_date >= subscription_start_date)
    )
  `);
  await knex.raw(`
    UPDATE trader_profiles
       SET subscription_start_date = CURRENT_DATE,
           subscription_end_date = (CURRENT_DATE + INTERVAL '1 year')::date
     WHERE status IN ('APPROVED', 'SUSPENDED')
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE trader_profiles DROP CONSTRAINT IF EXISTS chk_trader_profiles_subscription_period',
  );
  await knex.schema.alterTable('trader_profiles', (t) => {
    t.dropColumn('renewal_requested_at');
    t.dropColumn('subscription_end_date');
    t.dropColumn('subscription_start_date');
  });
}
