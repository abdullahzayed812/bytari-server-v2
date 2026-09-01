import type { Knex } from 'knex';

/**
 * Extend `system_supervisor_assignments.domain` with HOME_AD, mirroring the
 * CONTENT domain added alongside Phase 14 (docs 03 §3.10). Additive: the
 * check is dropped and recreated with the new value in the allowed set.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`,
  );
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN ('ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY', 'HOME_AD'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`,
  );
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN ('ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY'))
  `);
}
