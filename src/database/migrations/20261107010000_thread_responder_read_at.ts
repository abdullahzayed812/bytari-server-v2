import type { Knex } from 'knex';

/**
 * Admin "new message" state for the support-thread kernel (consultations,
 * inquiries, support messages — the admin "رسائل المستخدمين" page).
 *
 * `responder_read_at` = the last time the RESPONDER side (ADMIN / a domain
 * supervisor) opened the thread. A thread is "new" while it has a creator
 * (`source = 'USER'`) message newer than that — computed at read time, so no
 * counter can drift or double-count. Shared by the whole responder team: one
 * reviewer opening it marks it reviewed for everyone.
 *
 * Backfill: a thread is considered reviewed up to its latest ADMIN / SUPERVISOR
 * reply, or its close time — so history already handled before this column
 * existed does not all light up as "new".
 */
const THREADS = [
  { thread: 'consultations', message: 'consultation_messages' },
  { thread: 'inquiries', message: 'inquiry_messages' },
  { thread: 'support_threads', message: 'support_thread_messages' },
] as const;

export async function up(knex: Knex): Promise<void> {
  for (const { thread, message } of THREADS) {
    await knex.schema.alterTable(thread, (t) => {
      t.timestamp('responder_read_at', { useTz: true }).nullable();
    });
    await knex.raw(
      `UPDATE ?? AS t SET responder_read_at = GREATEST(
         t.closed_at,
         (SELECT max(m.created_at) FROM ?? AS m
           WHERE m.thread_id = t.id AND m.source IN ('ADMIN', 'SUPERVISOR'))
       )`,
      [thread, message],
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const { thread } of THREADS) {
    await knex.schema.alterTable(thread, (t) => {
      t.dropColumn('responder_read_at');
    });
  }
}
