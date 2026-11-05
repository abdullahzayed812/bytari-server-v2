import type { Knex } from 'knex';

/**
 * `organization_memberships.assigned_at` — when the member took on their
 * CURRENT role in the organization. `created_at` is not enough: a member who
 * LEFT / was REMOVED and re-joins re-activates the SAME row (unique
 * `(organization_id, user_id)`), and a role change keeps the row too. The
 * repository resets `assigned_at` on (re-)activation and on a role change, so
 * the Admin "Poultry Supervisors" relationship date stays correct. Existing
 * rows are backfilled from `created_at` (the best value available).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('organization_memberships', (t) => {
    t.timestamp('assigned_at', { useTz: true }).nullable();
  });
  await knex.raw(`UPDATE organization_memberships SET assigned_at = created_at`);
  await knex.raw(`
    ALTER TABLE organization_memberships
      ALTER COLUMN assigned_at SET NOT NULL,
      ALTER COLUMN assigned_at SET DEFAULT now()
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('organization_memberships', (t) => {
    t.dropColumn('assigned_at');
  });
}
