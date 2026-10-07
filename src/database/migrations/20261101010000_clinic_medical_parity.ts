import type { Knex } from 'knex';

/**
 * Clinic Dashboard / Pet Details parity with the legacy `bytari` app.
 *
 *  - `medical_records`: the legacy full-exam / quick-review / lab / file fields
 *    (symptoms, severity, lab notes, record type, draft flag, prescription image
 *    and attachment R2 keys). Existing rows keep their meaning (`GENERAL`, not a
 *    draft, no attachments).
 *  - `vaccinations.status`: legacy `scheduled` / `completed` / `cancelled`
 *    lifecycle of the next dose. Existing rows: SCHEDULED when a next dose is
 *    due, else COMPLETED — nothing is overwritten with a misleading default.
 *  - `animal_reminders`: legacy `pet_reminders` (clinic-authored follow-ups).
 *  - `clinic_quick_review_templates`: legacy `clinic_quick_review_templates`.
 *  - `animals`: legacy `weight`, `is_neutered`, `medical_history`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medical_records', (t) => {
    t.text('symptoms').nullable();
    t.text('severity').nullable();
    t.text('lab_notes').nullable();
    t.text('record_type').notNullable().defaultTo('GENERAL');
    t.boolean('is_draft').notNullable().defaultTo(false);
    t.text('prescription_key').nullable();
    t.specificType('attachment_keys', 'text[]').notNullable().defaultTo('{}');
  });
  await knex.raw(`
    ALTER TABLE medical_records
      ADD CONSTRAINT chk_medical_records_severity
      CHECK (severity IS NULL OR severity IN ('MILD', 'MODERATE', 'SEVERE'))
  `);
  await knex.raw(`
    ALTER TABLE medical_records
      ADD CONSTRAINT chk_medical_records_record_type
      CHECK (record_type IN ('GENERAL', 'QUICK_REVIEW', 'FULL_EXAM', 'LAB', 'FILE'))
  `);

  await knex.schema.alterTable('vaccinations', (t) => {
    t.text('status').nullable();
  });
  await knex.raw(
    `UPDATE vaccinations SET status = CASE WHEN next_due_on IS NULL THEN 'COMPLETED' ELSE 'SCHEDULED' END`,
  );
  await knex.raw(`ALTER TABLE vaccinations ALTER COLUMN status SET NOT NULL`);
  await knex.raw(`ALTER TABLE vaccinations ALTER COLUMN status SET DEFAULT 'SCHEDULED'`);
  await knex.raw(`
    ALTER TABLE vaccinations
      ADD CONSTRAINT chk_vaccinations_status
      CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED'))
  `);

  await knex.schema.createTable('animal_reminders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // RESTRICT, like medical records: history is never cascade-erased.
    t.uuid('animal_id').notNullable().references('id').inTable('animals').onDelete('RESTRICT');
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('RESTRICT');
    t.uuid('recorded_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('title').notNullable();
    t.text('description').nullable();
    t.date('reminder_date').notNullable();
    t.text('reminder_type').notNullable().defaultTo('CHECKUP');
    t.boolean('is_completed').notNullable().defaultTo(false);
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('animal_id', 'idx_animal_reminders_animal');
    t.index(['organization_id', 'reminder_date'], 'idx_animal_reminders_org_date');
  });
  await knex.raw(`
    ALTER TABLE animal_reminders
      ADD CONSTRAINT chk_animal_reminders_type
      CHECK (reminder_type IN ('VACCINATION', 'MEDICATION', 'CHECKUP', 'OTHER'))
  `);

  await knex.schema.createTable('clinic_quick_review_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('template_type').notNullable().defaultTo('GENERAL');
    t.text('default_diagnosis').nullable();
    t.text('default_treatment').nullable();
    t.text('default_notes').nullable();
    t.integer('interval_days').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_clinic_quick_review_templates_org');
  });
  await knex.raw(`
    ALTER TABLE clinic_quick_review_templates
      ADD CONSTRAINT chk_clinic_quick_review_templates_type
      CHECK (template_type IN ('VACCINE', 'TREATMENT', 'DIAGNOSIS', 'GENERAL')),
      ADD CONSTRAINT chk_clinic_quick_review_templates_interval
      CHECK (interval_days IS NULL OR interval_days > 0)
  `);

  await knex.schema.alterTable('animals', (t) => {
    t.decimal('weight_kg', 6, 2).nullable();
    t.boolean('is_neutered').nullable();
    t.text('medical_history').nullable();
  });
  await knex.raw(`
    ALTER TABLE animals
      ADD CONSTRAINT chk_animals_weight_kg CHECK (weight_kg IS NULL OR weight_kg > 0)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE animals DROP CONSTRAINT IF EXISTS chk_animals_weight_kg');
  await knex.schema.alterTable('animals', (t) => {
    t.dropColumn('weight_kg');
    t.dropColumn('is_neutered');
    t.dropColumn('medical_history');
  });
  await knex.schema.dropTableIfExists('clinic_quick_review_templates');
  await knex.schema.dropTableIfExists('animal_reminders');
  await knex.raw('ALTER TABLE vaccinations DROP CONSTRAINT IF EXISTS chk_vaccinations_status');
  await knex.schema.alterTable('vaccinations', (t) => {
    t.dropColumn('status');
  });
  await knex.raw(
    'ALTER TABLE medical_records DROP CONSTRAINT IF EXISTS chk_medical_records_record_type',
  );
  await knex.raw(
    'ALTER TABLE medical_records DROP CONSTRAINT IF EXISTS chk_medical_records_severity',
  );
  await knex.schema.alterTable('medical_records', (t) => {
    t.dropColumn('symptoms');
    t.dropColumn('severity');
    t.dropColumn('lab_notes');
    t.dropColumn('record_type');
    t.dropColumn('is_draft');
    t.dropColumn('prescription_key');
    t.dropColumn('attachment_keys');
  });
}
