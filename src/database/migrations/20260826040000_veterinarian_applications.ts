import type { Knex } from 'knex';

/**
 * Phase 2 — Veterinarian approval workflow.
 *
 * `users.veterinarian_status` holds the current denormalised state; this table
 * is the application history / audit trail. A user may re-apply after a
 * rejection (new row); only ONE PENDING row per user is allowed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('veterinarian_applications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('note').nullable(); // applicant-provided motivation
    t.uuid('decided_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.text('decision_reason').nullable(); // required on rejection
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // VETERINARIAN vs STUDENT — see `veterinarian_application_documents`
    // (its own migration), which carries the supporting identity documents.
    t.text('sub_type').notNullable().defaultTo('VETERINARIAN');

    t.index('status', 'idx_vet_applications_status');
    t.index('user_id', 'idx_vet_applications_user');
  });

  await knex.raw(`
    ALTER TABLE veterinarian_applications
      ADD CONSTRAINT chk_vet_applications_status
      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
  `);
  await knex.raw(
    `ALTER TABLE veterinarian_applications ADD CONSTRAINT chk_veterinarian_applications_sub_type
       CHECK (sub_type IN ('VETERINARIAN', 'STUDENT'))`,
  );

  await knex.raw(`
    CREATE UNIQUE INDEX uq_vet_applications_one_pending
      ON veterinarian_applications (user_id)
      WHERE status = 'PENDING'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('veterinarian_applications');
}
