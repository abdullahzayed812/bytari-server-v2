import type { Knex } from 'knex';

/**
 * Phase 13 — Consultations & Inquiries.
 *
 * Two structurally-identical support-thread aggregates (docs 05 §5.18–5.19,
 * UC-020…UC-027) kept as fully SEPARATE tables for referential integrity — no
 * polymorphic `thread_type` column:
 *
 *   consultations        Pet Owner → general veterinary consultation (optional
 *   consultation_messages animal reference; the owner must own that animal).
 *
 *   inquiries            Approved Veterinarian → general inquiry (no animal
 *   inquiry_messages     reference — it is a general question).
 *
 * A thread is OPEN or CLOSED. A supervisor/admin may also `block` the sender
 * (`sender_blocked_at`) — the creator becomes read-only while responders keep
 * writing (UC-023 / UC-027). CLOSED is terminal for everyone.
 *
 * Message `source` ∈ USER | SUPERVISOR | ADMIN | AI | SYSTEM. `sender_user_id`
 * is NULL for AI / SYSTEM. Responder identity is always derived from
 * `req.auth` — never from the body.
 *
 * `ai_settings` is a tiny admin-owned key/value flag table (CONSULTATION_AI,
 * INQUIRY_AI). It deliberately has NO FK to `users` so the test-suite's
 * `TRUNCATE users CASCADE` never wipes it; the service upserts and reads
 * default to `false`, so a missing row is harmless.
 */
async function createThreadTables(
  knex: Knex,
  opts: { thread: string; message: string; withAnimal: boolean },
): Promise<void> {
  await knex.schema.createTable(opts.thread, (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('created_by_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    if (opts.withAnimal) {
      t.uuid('animal_id').nullable().references('id').inTable('animals').onDelete('SET NULL');
    }
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
    // NULL for AI / SYSTEM messages.
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
  // A human message must name its sender; AI/SYSTEM must not.
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
    thread: 'consultations',
    message: 'consultation_messages',
    withAnimal: true,
  });
  await createThreadTables(knex, {
    thread: 'inquiries',
    message: 'inquiry_messages',
    withAnimal: false,
  });

  await knex.schema.createTable('ai_settings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('key').notNullable().unique();
    t.boolean('enabled').notNullable().defaultTo(false);
    // Plain uuid (no FK) on purpose — see the file header.
    t.uuid('updated_by_user_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE ai_settings ADD CONSTRAINT chk_ai_settings_key
       CHECK (key IN ('CONSULTATION_AI', 'INQUIRY_AI'))`,
  );
  await knex('ai_settings').insert([
    { key: 'CONSULTATION_AI', enabled: false },
    { key: 'INQUIRY_AI', enabled: false },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_settings');
  await knex.schema.dropTableIfExists('inquiry_messages');
  await knex.schema.dropTableIfExists('inquiries');
  await knex.schema.dropTableIfExists('consultation_messages');
  await knex.schema.dropTableIfExists('consultations');
}
