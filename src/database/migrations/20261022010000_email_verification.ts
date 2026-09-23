import type { Knex } from 'knex';

/**
 * Mandatory email verification for self-registered (Pet Owner) accounts.
 *
 * `users.status` gains `PENDING_VERIFICATION` — the state `AuthService.register()`
 * now creates every new account in. Nothing else changes it: admin-created
 * users, dev-seed personas and the bootstrap admin all insert `ACTIVE`
 * directly (never through `AuthService.register()`), so they are unaffected.
 *
 * `email_verifications` holds one row per outstanding code. Only a SHA-256
 * hash of the 6-digit code is stored (mirrors `refresh_sessions.token_hash` —
 * see `refresh-session.service.ts`); the raw code exists only in the outbound
 * email. A resend (or a fresh `register()` for the same, still-unverified,
 * account — not possible today since email is unique, kept generic for any
 * future re-issue path) invalidates the previous row rather than stacking
 * multiple valid codes — see `EmailVerificationService`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT chk_users_status`);
  await knex.raw(`
    ALTER TABLE users
      ADD CONSTRAINT chk_users_status
      CHECK (status IN ('ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED'))
  `);

  await knex.schema.createTable('email_verifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('code_hash').notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    // Set once the code is successfully verified; NULL means still outstanding.
    // A resend also consumes the row it replaces, so "outstanding" always means
    // "the current, still-guessable code" — never a stale one left valid.
    t.timestamp('consumed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('user_id', 'idx_email_verifications_user');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('email_verifications');

  await knex.raw(`ALTER TABLE users DROP CONSTRAINT chk_users_status`);
  await knex.raw(`
    ALTER TABLE users
      ADD CONSTRAINT chk_users_status
      CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'))
  `);
}
