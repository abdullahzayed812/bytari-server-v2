import type { Knex } from 'knex';

/**
 * Poultry Farm subscription layer — separate from `organizations.status`
 * (the approval state). A FARM's subscription validity is derived server-side
 * from `farm_details.subscription_start_date`/`subscription_end_date` vs
 * `now()` (see `computeFarmSubscriptionStatus` in
 * `src/modules/farms/domain/farm-subscription.types.ts`) — deliberately NOT a
 * stored status column, so there is nothing to drift out of sync.
 *
 * `farm_subscription_renewal_requests` is the owner-submits/admin-reviews
 * workflow (spec §6), shaped like `veterinarian_applications` /
 * `animal_transfer_requests`: one open (PENDING) request per organization at
 * a time, `decided_by`/`decided_at`/`decision_reason` on resolution.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('farm_details', (t) => {
    t.date('subscription_start_date').nullable();
    t.date('subscription_end_date').nullable();
  });
  await knex.raw(`
    ALTER TABLE farm_details
      ADD CONSTRAINT chk_farm_details_subscription_dates
      CHECK (
        subscription_start_date IS NULL
        OR subscription_end_date IS NULL
        OR subscription_end_date >= subscription_start_date
      )
  `);

  await knex.schema.createTable('farm_subscription_renewal_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('requested_by_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('note').nullable(); // owner-provided motivation
    t.date('previous_subscription_end_date').nullable(); // snapshot at request time
    t.date('new_subscription_start_date').nullable(); // filled in on approval
    t.date('new_subscription_end_date').nullable(); // filled in on approval
    t.uuid('decided_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.text('decision_reason').nullable(); // required on rejection
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_farm_renewal_requests_org');
    t.index('status', 'idx_farm_renewal_requests_status');
  });

  await knex.raw(`
    ALTER TABLE farm_subscription_renewal_requests
      ADD CONSTRAINT chk_farm_renewal_requests_status
      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
  `);

  // At most one open renewal request per farm.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_farm_renewal_requests_one_pending
      ON farm_subscription_renewal_requests (organization_id)
      WHERE status = 'PENDING'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('farm_subscription_renewal_requests');

  await knex.raw(
    `ALTER TABLE farm_details DROP CONSTRAINT IF EXISTS chk_farm_details_subscription_dates`,
  );
  await knex.schema.alterTable('farm_details', (t) => {
    t.dropColumn('subscription_start_date');
    t.dropColumn('subscription_end_date');
  });
}
