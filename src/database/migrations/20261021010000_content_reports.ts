import type { Knex } from 'knex';

/**
 * Content reporting — "الإبلاغ عن الرسالة" (Global Chat) and, generically, any
 * other reportable content. A single flat table (no polymorphic per-target
 * tables): `target_type` + `target_id` name what was reported, resolved
 * application-side (never a DB-level FK, since the target can be a `messages`
 * row or an `organizations` row).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('content_reports', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('reporter_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('target_type').notNullable();
    t.uuid('target_id').notNullable();
    t.text('reason').notNullable();
    t.text('details').nullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['status', 'created_at'], 'idx_content_reports_status_recent');
    t.index(['target_type', 'target_id'], 'idx_content_reports_target');
    t.index('reporter_user_id', 'idx_content_reports_reporter');
  });

  await knex.raw(
    `ALTER TABLE content_reports ADD CONSTRAINT chk_content_reports_target_type
       CHECK (target_type IN ('MESSAGE', 'ROOM'))`,
  );
  await knex.raw(
    `ALTER TABLE content_reports ADD CONSTRAINT chk_content_reports_reason
       CHECK (reason IN (
         'INAPPROPRIATE_CONTENT', 'MISLEADING_INFO', 'HARASSMENT', 'SPAM',
         'RULES_VIOLATION', 'OTHER'
       ))`,
  );
  await knex.raw(
    `ALTER TABLE content_reports ADD CONSTRAINT chk_content_reports_status
       CHECK (status IN ('PENDING', 'REVIEWED', 'DISMISSED'))`,
  );
  await knex.raw(
    `ALTER TABLE content_reports ADD CONSTRAINT chk_content_reports_reviewed
       CHECK (
         (status = 'PENDING' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL) OR
         (status != 'PENDING' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
       )`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('content_reports');
}
