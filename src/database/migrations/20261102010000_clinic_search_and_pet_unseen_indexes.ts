import type { Knex } from 'knex';

/**
 * Clinic Dashboard search + owner "new information" counters.
 *
 *  - `idx_animal_clinic_access_org_active_recent` — the clinic patient list /
 *    search (`organization_id` + ACTIVE grants, newest first). Name / breed /
 *    owner matching then runs only over that clinic's own patients.
 *  - `idx_notifications_unread_pet` — per-pet unread pet-care notifications
 *    (`data->>'animalId'`) for the Pet Details counters; partial on unread rows.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_animal_clinic_access_org_active_recent
      ON animal_clinic_access (organization_id, created_at DESC)
      WHERE status = 'ACTIVE'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_notifications_unread_pet
      ON notifications (recipient_user_id, ((data->>'animalId')))
      WHERE read_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_notifications_unread_pet');
  await knex.raw('DROP INDEX IF EXISTS idx_animal_clinic_access_org_active_recent');
}
