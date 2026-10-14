import type { Knex } from 'knex';

/**
 * Farm appointments ("المواعيد") gain an optional ASSIGNED veterinarian — an
 * ACTIVE VETERINARIAN member of the same farm (validated by the service; a
 * DB-level check would need the membership table). The assignee is notified
 * when assigned and on the scheduled day (`FarmAppointmentDueNotifier`).
 * Deleting the user account clears the assignment, never the appointment.
 *
 * The partial index backs the hourly "due today" sweep.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('farm_appointments', (t) => {
    t.uuid('assigned_veterinarian_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
  });
  await knex.raw(
    `CREATE INDEX idx_farm_appointments_upcoming_date
       ON farm_appointments (scheduled_for, id) WHERE status = 'UPCOMING'`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_farm_appointments_upcoming_date');
  await knex.schema.alterTable('farm_appointments', (t) => {
    t.dropColumn('assigned_veterinarian_user_id');
  });
}
