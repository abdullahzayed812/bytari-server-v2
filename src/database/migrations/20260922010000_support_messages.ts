import type { Knex } from 'knex';

/**
 * "تواصل معنا" — support messages to the administration.
 *
 * A third support-thread aggregate on the SAME kernel as Phase 13's
 * consultations / inquiries (`20260903010000_consultations_inquiries.ts`), kept
 * as its own pair of tables (no polymorphic `thread_type`):
 *
 *   support_threads          any signed-in user → a message to the admin team
 *   support_thread_messages  (no animal reference — it is a general support msg)
 *
 * Responder side = ADMIN, or an ACTIVE `SUPPORT` system-supervisor domain
 * assignment (`SUPERVISOR_DOMAIN_PERMISSIONS.SUPPORT` — the `SUPPORT` value
 * lives in `system_supervisor_assignments.domain`'s CHECK, consolidated in
 * `20260826050000_system_supervisor_assignments.ts`). Message `source`,
 * OPEN/CLOSED lifecycle and the sender-block mechanism are identical to the
 * other two kinds. Creation is authentication-only (no eligibility gate).
 *
 * `ai_settings.key`'s `SUPPORT_AI` row (seeded disabled — support has no AI
 * responder, but the flag keeps the table uniform / future-proof) is
 * consolidated in `20260903010000_consultations_inquiries.ts`, which owns
 * `ai_settings`.
 */
async function createThreadTables(
  knex: Knex,
  opts: { thread: string; message: string },
): Promise<void> {
  await knex.schema.createTable(opts.thread, (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('created_by_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.text('status').notNullable().defaultTo('OPEN');
    t.timestamp('sender_blocked_at', { useTz: true }).nullable();
    t.boolean('ai_responded').notNullable().defaultTo(false);
    t.timestamp('last_message_at', { useTz: true }).nullable();
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.uuid('closed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('created_by_user_id', `idx_${opts.thread}_creator`);
    t.index(['status', 'last_message_at'], `idx_${opts.thread}_status_recent`);
  });
  await knex.raw(
    `ALTER TABLE ${opts.thread} ADD CONSTRAINT chk_${opts.thread}_status CHECK (status IN ('OPEN', 'CLOSED'))`,
  );

  await knex.schema.createTable(opts.message, (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('thread_id').notNullable().references('id').inTable(opts.thread).onDelete('CASCADE');
    t.uuid('sender_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('source').notNullable();
    t.text('body').notNullable();
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['thread_id', 'created_at', 'id'], `idx_${opts.message}_ordered`);
  });
  await knex.raw(
    `ALTER TABLE ${opts.message} ADD CONSTRAINT chk_${opts.message}_source
       CHECK (source IN ('USER', 'SUPERVISOR', 'ADMIN', 'AI', 'SYSTEM'))`,
  );
  await knex.raw(
    `ALTER TABLE ${opts.message} ADD CONSTRAINT chk_${opts.message}_body_len
       CHECK (char_length(body) BETWEEN 1 AND 4000)`,
  );
  await knex.raw(
    `ALTER TABLE ${opts.message} ADD CONSTRAINT chk_${opts.message}_sender
       CHECK (
         (source IN ('USER', 'SUPERVISOR', 'ADMIN') AND sender_user_id IS NOT NULL) OR
         (source IN ('AI', 'SYSTEM') AND sender_user_id IS NULL)
       )`,
  );
}

export async function up(knex: Knex): Promise<void> {
  await createThreadTables(knex, {
    thread: 'support_threads',
    message: 'support_thread_messages',
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('support_thread_messages');
  await knex.schema.dropTableIfExists('support_threads');
}
