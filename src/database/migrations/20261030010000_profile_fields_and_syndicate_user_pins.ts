import type { Knex } from 'knex';

/**
 * UI/search/profile phase (2026-10-04).
 *
 * 1. Profile page ("نبذة عني" + "واتساب"): `users.bio` and `users.whatsapp`,
 *    both optional and self-editable via `PATCH /users/me`.
 *
 * 2. "تثبيت النقابة" becomes PER VETERINARIAN: every vet pins / unpins
 *    syndicates for their own quick access on the Veterinarian Home. The
 *    former global admin flag (`syndicate_details.pinned_to_home_at`) is
 *    replaced by `syndicate_home_pins` — a pin belongs to exactly one user.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.text('bio').nullable();
    t.string('whatsapp', 32).nullable();
  });
  await knex.raw(
    'ALTER TABLE users ADD CONSTRAINT chk_users_bio_length CHECK (bio IS NULL OR char_length(bio) <= 1000)',
  );

  await knex.schema.createTable('syndicate_home_pins', (t) => {
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.timestamp('pinned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'organization_id']);
  });
  await knex.raw(
    'CREATE INDEX idx_syndicate_home_pins_user ON syndicate_home_pins (user_id, pinned_at)',
  );

  // The admin-only pin permission no longer guards anything (cascades to role_permissions).
  await knex('permissions').where({ key: 'syndicate.admin.pin' }).delete();

  await knex.raw('DROP INDEX IF EXISTS idx_syndicate_details_pinned');
  await knex.schema.alterTable('syndicate_details', (t) => {
    t.dropColumn('pinned_to_home_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('syndicate_details', (t) => {
    t.timestamp('pinned_to_home_at', { useTz: true }).nullable();
  });
  await knex.raw(
    'CREATE INDEX idx_syndicate_details_pinned ON syndicate_details (pinned_to_home_at) WHERE pinned_to_home_at IS NOT NULL',
  );
  await knex.schema.dropTableIfExists('syndicate_home_pins');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_bio_length');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('whatsapp');
    t.dropColumn('bio');
  });
}
