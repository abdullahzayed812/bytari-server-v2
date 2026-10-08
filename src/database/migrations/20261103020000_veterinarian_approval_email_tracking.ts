import type { Knex } from 'knex';

/**
 * Exactly-once veterinarian approval email.
 *
 * `veterinarian_applications.approval_email_sent_at` is the idempotency claim:
 * the `veterinarian.approved` handler sets it atomically (only while NULL)
 * before sending, and clears it again if delivery fails so the retry sweep can
 * pick the application up. Applications approved before this migration are
 * marked as already emailed (the handler shipped earlier) so the sweep never
 * mails old approvals.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinarian_applications', (t) => {
    t.timestamp('approval_email_sent_at', { useTz: true }).nullable();
  });
  await knex.raw(`
    UPDATE veterinarian_applications
       SET approval_email_sent_at = COALESCE(decided_at, updated_at)
     WHERE status = 'APPROVED'
  `);
  // The retry sweep: recent APPROVED applications still waiting for their email.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_vet_applications_approval_email_pending
      ON veterinarian_applications (decided_at)
      WHERE status = 'APPROVED' AND approval_email_sent_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_vet_applications_approval_email_pending');
  await knex.schema.alterTable('veterinarian_applications', (t) => {
    t.dropColumn('approval_email_sent_at');
  });
}
