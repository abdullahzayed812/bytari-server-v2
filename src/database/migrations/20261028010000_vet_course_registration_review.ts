import type { Knex } from 'knex';

/**
 * Courses & Seminars registrants are now REVIEWED by management (final
 * corrections phase §3): a registration starts PENDING and an ADMIN /
 * VET_COURSES supervisor approves or rejects it. Rows that already existed were
 * effectively confirmed under the old flow, so they are backfilled APPROVED;
 * only new registrations start PENDING. A REJECTED registration frees its seat.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vet_course_registrations', (t) => {
    t.text('status').notNullable().defaultTo('APPROVED');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('rejection_reason').nullable();
  });
  await knex.raw(`ALTER TABLE vet_course_registrations ALTER COLUMN status SET DEFAULT 'PENDING'`);
  await knex.raw(`
    ALTER TABLE vet_course_registrations ADD CONSTRAINT chk_vet_course_registrations_status
      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
  `);
  await knex.raw(`
    ALTER TABLE vet_course_registrations ADD CONSTRAINT chk_vet_course_registrations_reason_len
      CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 1000)
  `);
  await knex.raw(
    `CREATE INDEX idx_vet_course_registrations_pending ON vet_course_registrations (course_id) WHERE status = 'PENDING'`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_vet_course_registrations_pending');
  await knex.schema.alterTable('vet_course_registrations', (t) => {
    t.dropColumn('rejection_reason');
    t.dropColumn('reviewed_by_user_id');
    t.dropColumn('reviewed_at');
    t.dropColumn('status');
  });
}
