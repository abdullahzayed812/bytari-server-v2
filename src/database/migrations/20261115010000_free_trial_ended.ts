import type { Knex } from 'knex';

/**
 * "الفترة المجانية" is shown only during an organization's FIRST subscription
 * period. The first time a new period is activated after an earlier one has
 * already ended (owner sends the subscription info → admin re-activates),
 * `free_trial_ended_at` is stamped on that organization's `*_details` row and
 * is never cleared again — later renewals / expirations don't bring the card
 * back. Set by `FarmSubscriptionRenewalRepository.setSubscriptionDates`, the
 * single write path for subscription dates.
 *
 * Backfill (existing data is preserved, only the new column is written): an
 * organization has already left its free trial when
 *  - it has an APPROVED subscription renewal request, or
 *  - the audit log shows a subscription set AFTER an earlier set's end date.
 */
const TABLES = ['clinic_details', 'veterinary_office_details', 'farm_details'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.timestamp('free_trial_ended_at', { useTz: true }).nullable();
    });
    await knex.raw(
      `UPDATE ${table} d SET free_trial_ended_at = now()
        WHERE EXISTS (
                SELECT 1 FROM farm_subscription_renewal_requests r
                 WHERE r.organization_id = d.organization_id AND r.status = 'APPROVED')
           OR EXISTS (
                SELECT 1 FROM audit_logs earlier
                  JOIN audit_logs later
                    ON later.entity_id = earlier.entity_id
                   AND later.action = earlier.action
                   AND later.created_at > earlier.created_at
                 WHERE earlier.action = 'FARM_SUBSCRIPTION_SET'
                   AND earlier.entity_id = d.organization_id
                   AND later.created_at::date >
                       CASE WHEN earlier.metadata->>'endDate' ~ '^\\d{4}-\\d{2}-\\d{2}$'
                            THEN (earlier.metadata->>'endDate')::date END)`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('free_trial_ended_at');
    });
  }
}
