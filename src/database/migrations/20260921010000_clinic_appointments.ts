import type { Knex } from 'knex';

/**
 * "حجز موعد" — the Pet Owner ↔ Clinic appointment request/booking workflow.
 *
 * A pet owner requests a visit for one of their animals at a CLINIC
 * organization (visit type + preferred date/time + optional note). The request
 * starts PENDING; the clinic later CONFIRMS, REJECTS, or PROPOSES an alternative
 * slot (RESCHEDULE_PROPOSED). The owner may CANCEL an open request or respond to
 * a proposed reschedule (accept → CONFIRMED, decline → CANCELLED). A confirmed
 * appointment can be marked COMPLETED after the visit.
 *
 * Access mirrors chat's PET_OWNER_CLINIC relationship: the owner side is
 * `pet_owner_user_id`; the clinic side is resolved live from
 * `organization_memberships` (any ACTIVE member) — no stored clinic-side row.
 *
 * `clinic_appointment_events` is an append-only history/timeline (one row per
 * state change), backing the future Clinic Dashboard's "سجل المواعيد".
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('clinic_appointments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('animal_id').notNullable().references('id').inTable('animals').onDelete('CASCADE');
    // Denormalised owner id — the appointment stays attached to the user who
    // booked it even if the animal is later transferred.
    t.uuid('pet_owner_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.text('visit_type').notNullable();
    t.timestamp('scheduled_for', { useTz: true }).notNullable();
    t.timestamp('proposed_scheduled_for', { useTz: true }).nullable();
    t.text('note').nullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('decision_reason').nullable();
    t.uuid('decided_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.uuid('created_by_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_clinic_appointments_org');
    t.index('pet_owner_user_id', 'idx_clinic_appointments_owner');
    t.index('animal_id', 'idx_clinic_appointments_animal');
    t.index('status', 'idx_clinic_appointments_status');
    t.index(['organization_id', 'status'], 'idx_clinic_appointments_org_status');
    t.index(['pet_owner_user_id', 'status'], 'idx_clinic_appointments_owner_status');
  });

  await knex.raw(`
    ALTER TABLE clinic_appointments
      ADD CONSTRAINT chk_clinic_appointments_visit_type
      CHECK (visit_type IN ('CHECKUP', 'VACCINATION', 'FOLLOW_UP', 'SURGERY', 'OTHER'))
  `);
  await knex.raw(`
    ALTER TABLE clinic_appointments
      ADD CONSTRAINT chk_clinic_appointments_status
      CHECK (status IN ('PENDING', 'CONFIRMED', 'RESCHEDULE_PROPOSED', 'COMPLETED', 'REJECTED', 'CANCELLED'))
  `);

  await knex.schema.createTable('clinic_appointment_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('appointment_id')
      .notNullable()
      .references('id')
      .inTable('clinic_appointments')
      .onDelete('CASCADE');
    t.text('kind').notNullable();
    t.text('actor_side').notNullable();
    t.uuid('actor_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('from_scheduled_for', { useTz: true }).nullable();
    t.timestamp('to_scheduled_for', { useTz: true }).nullable();
    t.text('reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('appointment_id', 'idx_clinic_appointment_events_appointment');
  });

  await knex.raw(`
    ALTER TABLE clinic_appointment_events
      ADD CONSTRAINT chk_clinic_appointment_events_kind
      CHECK (kind IN ('REQUESTED', 'CONFIRMED', 'REJECTED', 'RESCHEDULE_PROPOSED',
                      'RESCHEDULE_ACCEPTED', 'RESCHEDULE_DECLINED', 'CANCELLED', 'COMPLETED'))
  `);
  await knex.raw(`
    ALTER TABLE clinic_appointment_events
      ADD CONSTRAINT chk_clinic_appointment_events_actor_side
      CHECK (actor_side IN ('PET_OWNER', 'CLINIC'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('clinic_appointment_events');
  await knex.schema.dropTableIfExists('clinic_appointments');
}
