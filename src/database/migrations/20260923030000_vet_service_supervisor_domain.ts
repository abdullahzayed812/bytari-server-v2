import type { Knex } from 'knex';

/**
 * Extend `system_supervisor_assignments.domain` with `VET_SERVICE` — the
 * "authorized specialist supervisor" for the Veterinary Services marketplace
 * (approve / reject service listings + pet-owner requests). Additive: drop and
 * recreate the CHECK with the new value in the allowed set, mirroring
 * `20260922010000_support_messages.ts`.
 */
const DOMAINS_BEFORE = [
  'ANIMAL',
  'CLINIC',
  'STORE',
  'CONTENT',
  'CONSULTATION',
  'INQUIRY',
  'SUPPORT',
  'ADVERTISEMENT',
  'MARKET',
  'PET_OWNER_STORE',
];
const DOMAINS_AFTER = [...DOMAINS_BEFORE, 'VET_SERVICE'];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${DOMAINS_AFTER.map((d) => `'${d}'`).join(', ')}))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DELETE FROM system_supervisor_assignments WHERE domain = 'VET_SERVICE'`);
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${DOMAINS_BEFORE.map((d) => `'${d}'`).join(', ')}))
  `);
}
