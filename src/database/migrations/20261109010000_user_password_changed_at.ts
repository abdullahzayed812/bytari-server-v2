import type { Knex } from 'knex';

/**
 * `users.password_changed_at` — set whenever the password hash is replaced
 * (admin set, reset code, self change). Access tokens are stateless JWTs, so
 * revoking refresh sessions alone leaves an already-issued access token usable
 * until it expires; `authenticate` (HTTP + realtime) rejects any access token
 * issued before this instant. NULL for accounts whose password never changed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.timestamp('password_changed_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('password_changed_at');
  });
}
