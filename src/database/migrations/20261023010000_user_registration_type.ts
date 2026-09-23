import type { Knex } from 'knex';

/**
 * Which self-registration path created the account — the two paths have
 * different onboarding gates (see `accessStateFor` in `users/user-access.ts`):
 *
 *   PET_OWNER    → mandatory email verification (`status = PENDING_VERIFICATION`
 *                  until the emailed code is confirmed). Default for every
 *                  existing row, admin-created user and dev-seed persona.
 *   VETERINARIAN → NO email verification (created `ACTIVE`), but blocked from
 *                  the normal app until an admin APPROVES the veterinarian
 *                  application (`veterinarian_status`).
 *
 * Not the same as `veterinarian_status`: an existing Pet Owner who later
 * applies in-app (`/veterinarian/apply`) stays `PET_OWNER` here and keeps full
 * Pet Owner access while their application is pending.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.text('registration_type').notNullable().defaultTo('PET_OWNER');
  });
  await knex.raw(
    `ALTER TABLE users ADD CONSTRAINT chk_users_registration_type CHECK (registration_type IN ('PET_OWNER', 'VETERINARIAN'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_registration_type`);
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('registration_type');
  });
}
