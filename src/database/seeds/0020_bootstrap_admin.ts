import type { Knex } from 'knex';
import { loadConfig } from '../../config/index.js';
import { PasswordService } from '../../modules/auth/password.service.js';

/**
 * Optional bootstrap ADMIN account.
 *
 * Runs only when BOTH `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` are
 * provided in the environment. No credentials are ever hardcoded. Idempotent:
 * re-seeding refreshes the password and re-activates the account.
 */
export async function seed(knex: Knex): Promise<void> {
  const config = loadConfig();
  const admin = config.auth.bootstrapAdmin;
  if (!admin) return;

  const passwordHash = await new PasswordService(config.auth).hash(admin.password);

  const existing: { id: string } | undefined = await knex('users')
    .where({ email: admin.email })
    .first();

  let userId: string;
  if (existing) {
    await knex('users')
      .where({ id: existing.id })
      .update({ password_hash: passwordHash, status: 'ACTIVE', updated_at: knex.fn.now() });
    userId = existing.id;
  } else {
    const inserted: Array<{ id: string }> = await knex('users')
      .insert({
        email: admin.email,
        password_hash: passwordHash,
        first_name: admin.firstName,
        last_name: admin.lastName,
        status: 'ACTIVE',
        veterinarian_status: 'NOT_APPLIED',
      })
      .returning('id');
    const row = inserted[0];
    if (!row) throw new Error('Failed to insert bootstrap admin user');
    userId = row.id;
  }

  const adminRole: { id: string } | undefined = await knex('roles').where({ key: 'ADMIN' }).first();
  if (adminRole) {
    await knex('user_roles')
      .insert({ user_id: userId, role_id: adminRole.id, assigned_by: null })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  }
}
