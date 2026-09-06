import type { Knex } from 'knex';

/**
 * Extend `system_supervisor_assignments.domain` with MARKET — the "authorized
 * market specialist" concept for Poultry Markets: governorate-wide data
 * (offer moderation + exchange-rate entry), not per-organization, so this
 * reuses the SAME system-wide supervisor mechanism as CONTENT/ADVERTISEMENT
 * rather than the per-organization supervisor mechanism. Additive: the check
 * is dropped and recreated with the new value in the allowed set.
 */
const DOMAINS_BEFORE = [
  'ANIMAL',
  'CLINIC',
  'STORE',
  'CONTENT',
  'CONSULTATION',
  'INQUIRY',
  'ADVERTISEMENT',
];
const DOMAINS_AFTER = [...DOMAINS_BEFORE, 'MARKET'];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`,
  );
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${DOMAINS_AFTER.map((d) => `'${d}'`).join(', ')}))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DELETE FROM system_supervisor_assignments WHERE domain = 'MARKET'`);
  await knex.raw(
    `ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`,
  );
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${DOMAINS_BEFORE.map((d) => `'${d}'`).join(', ')}))
  `);
}
