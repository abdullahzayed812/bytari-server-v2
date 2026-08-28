import type { Knex } from 'knex';

/**
 * Phase 5 — Veterinary Care & Medical Records.
 *
 *   animals ──< animal_clinic_access >── organizations   (CLINIC ↔ animal access grant)
 *   animals ──< medical_records       >── organizations
 *   animals ──< vaccinations          >── organizations
 *
 * Design notes:
 *  - Veterinary access to an animal is a DEDICATED relationship
 *    (`animal_clinic_access`), independent of animal ownership. A clinic member
 *    with `animal.veterinary.access.manage` grants it; it is revocable and
 *    audited. Being an APPROVED veterinarian, or a clinic member, does NOT by
 *    itself grant access to any animal.
 *  - Medical history belongs to the ANIMAL, not to the veterinarian who wrote
 *    it and not to the owner. `animal_id` / `organization_id` are
 *    `ON DELETE RESTRICT` so history cannot be cascade-erased; the recording
 *    user is `ON DELETE SET NULL` so attribution degrades gracefully but the
 *    record survives. Membership / ownership changes never touch these tables.
 *  - `medical_records` groups the spec's "Diagnoses / Treatments / Notes"
 *    (docs 04 §4.4) as fields of one dated entry; each visit is a NEW row, so
 *    historical diagnoses are never overwritten. Attachments are deferred
 *    (file storage is out of Phase 5 scope).
 */
export async function up(knex: Knex): Promise<void> {
  // --- clinic ↔ animal access ------------------------------------------
  await knex.schema.createTable('animal_clinic_access', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('animal_id').notNullable().references('id').inTable('animals').onDelete('CASCADE');
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.uuid('granted_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('revoked_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_animal_clinic_access_org');
    t.index('animal_id', 'idx_animal_clinic_access_animal');
  });
  await knex.raw(`
    ALTER TABLE animal_clinic_access
      ADD CONSTRAINT chk_animal_clinic_access_status CHECK (status IN ('ACTIVE', 'REVOKED'))
  `);
  // At most one ACTIVE access grant per (animal, clinic).
  await knex.raw(`
    CREATE UNIQUE INDEX uq_animal_clinic_access_active
      ON animal_clinic_access (animal_id, organization_id)
      WHERE status = 'ACTIVE'
  `);

  // --- medical records ------------------------------------------------
  await knex.schema.createTable('medical_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // RESTRICT: medical history must not be cascade-deleted.
    t.uuid('animal_id').notNullable().references('id').inTable('animals').onDelete('RESTRICT');
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('RESTRICT');
    // The clinic member who recorded the entry. SET NULL: the record outlives
    // the veterinarian and never depends on them for authorization.
    t.uuid('recorded_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.date('visit_date').notNullable().defaultTo(knex.raw('CURRENT_DATE'));
    t.text('reason').nullable();
    t.text('diagnosis').nullable();
    t.text('treatment').nullable();
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('animal_id', 'idx_medical_records_animal');
    t.index(['organization_id', 'animal_id'], 'idx_medical_records_org_animal');
  });

  // --- vaccinations -------------------------------------------------
  await knex.schema.createTable('vaccinations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('animal_id').notNullable().references('id').inTable('animals').onDelete('RESTRICT');
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('RESTRICT');
    t.uuid('recorded_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('vaccine_name').notNullable();
    t.date('administered_on').notNullable();
    t.date('next_due_on').nullable();
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('animal_id', 'idx_vaccinations_animal');
    t.index(['organization_id', 'animal_id'], 'idx_vaccinations_org_animal');
    t.index('next_due_on', 'idx_vaccinations_next_due');
  });
  await knex.raw(`
    ALTER TABLE vaccinations
      ADD CONSTRAINT chk_vaccinations_due_after
      CHECK (next_due_on IS NULL OR next_due_on >= administered_on)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vaccinations');
  await knex.schema.dropTableIfExists('medical_records');
  await knex.schema.dropTableIfExists('animal_clinic_access');
}
