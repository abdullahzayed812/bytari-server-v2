import type { Knex } from 'knex';

/**
 * Registration corrections + password reset.
 *
 * - `users.governorate` — the governorate / state / province picked after the
 *   country at registration (free text, validated per-country in the app layer;
 *   Iraq is validated against a fixed list). Nullable: pre-existing rows and
 *   admin-created users have none.
 * - `users.specialization` — optional veterinarian specialization ("التخصص"),
 *   captured at veterinarian registration and editable from the profile.
 * - `email_verifications.purpose` — the one-time-code table is reused for
 *   password-reset codes instead of adding a parallel table: same shape (hashed
 *   6-digit code, expiry, attempt counter, consumed-at). Every existing row is
 *   an email-verification code, hence the default.
 *
 * Phone stays NULLABLE at the DB level on purpose: legacy / admin-created rows
 * have no phone. "Phone is required" is enforced by the registration schema.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.text('governorate').nullable();
    t.text('specialization').nullable();
  });
  await knex.raw(
    `ALTER TABLE users ADD CONSTRAINT chk_users_governorate_len CHECK (governorate IS NULL OR char_length(governorate) BETWEEN 1 AND 100)`,
  );
  await knex.raw(
    `ALTER TABLE users ADD CONSTRAINT chk_users_specialization_len CHECK (specialization IS NULL OR char_length(specialization) BETWEEN 1 AND 150)`,
  );

  await knex.schema.alterTable('email_verifications', (t) => {
    t.text('purpose').notNullable().defaultTo('EMAIL_VERIFICATION');
  });
  await knex.raw(
    `ALTER TABLE email_verifications ADD CONSTRAINT chk_email_verifications_purpose CHECK (purpose IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET'))`,
  );
  await knex.raw(`DROP INDEX IF EXISTS idx_email_verifications_user`);
  await knex.raw(
    `CREATE INDEX idx_email_verifications_user_purpose ON email_verifications (user_id, purpose)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_email_verifications_user_purpose`);
  await knex.raw(`DELETE FROM email_verifications WHERE purpose <> 'EMAIL_VERIFICATION'`);
  await knex.raw(
    `ALTER TABLE email_verifications DROP CONSTRAINT IF EXISTS chk_email_verifications_purpose`,
  );
  await knex.schema.alterTable('email_verifications', (t) => {
    t.dropColumn('purpose');
  });
  await knex.raw(`CREATE INDEX idx_email_verifications_user ON email_verifications (user_id)`);

  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_specialization_len`);
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_governorate_len`);
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('specialization');
    t.dropColumn('governorate');
  });
}
