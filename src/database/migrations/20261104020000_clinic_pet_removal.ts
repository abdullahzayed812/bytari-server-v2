import type { Knex } from 'knex';

/**
 * "Remove pet from this clinic" (Clinic Dashboard).
 *
 * A clinic's relationship with a pet is derived from the rows it authored in
 * `medical_records` / `vaccinations` / `animal_reminders` (no link table), and
 * every clinic read is scoped by `organization_id`. Removing a pet therefore
 * DETACHES that clinic's rows instead of deleting them:
 *
 *   organization_id      → NULL   (gone from every clinic view, list, count)
 *   recorded_by_user_id  → NULL   (owner views no longer name the vet)
 *   removed_from_organization_id / removed_recorded_by_user_id
 *                        ← the original attribution, kept server-side only
 *                          for accountability (never returned by any API)
 *   removed_at / removed_by_user_id ← who removed it, when
 *
 * Owner-visible vaccinations / reminders stay readable by the owner (with no
 * clinic / vet identity); clinic-private medical records are archived — kept
 * (medical history is never destroyed) but invisible everywhere. The clinic
 * can open the same pet again by its public ID; new rows re-list it.
 */
const TABLES = ['medical_records', 'vaccinations', 'animal_reminders'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.uuid('organization_id').nullable().alter();
      t.uuid('removed_from_organization_id')
        .nullable()
        .references('id')
        .inTable('organizations')
        .onDelete('RESTRICT');
      t.uuid('removed_recorded_by_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
      t.timestamp('removed_at', { useTz: true }).nullable();
      t.uuid('removed_by_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
    });
    // A row always keeps its clinic attribution — live or archived.
    await knex.raw(`
      ALTER TABLE ${table}
        ADD CONSTRAINT chk_${table}_clinic_attribution
        CHECK (organization_id IS NOT NULL OR removed_from_organization_id IS NOT NULL)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    // Re-attach detached rows so NOT NULL can be restored.
    await knex.raw(`
      UPDATE ${table}
         SET organization_id = removed_from_organization_id,
             recorded_by_user_id = COALESCE(recorded_by_user_id, removed_recorded_by_user_id)
       WHERE organization_id IS NULL
    `);
    await knex.raw(
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_clinic_attribution`,
    );
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('removed_from_organization_id');
      t.dropColumn('removed_recorded_by_user_id');
      t.dropColumn('removed_at');
      t.dropColumn('removed_by_user_id');
      t.uuid('organization_id').notNullable().alter();
    });
  }
}
