import type { Knex } from 'knex';

/**
 * Extend `system_supervisor_assignments.domain` with `PET_OWNER_STORE` — the
 * "authorized Pet Owners Store supervisor" concept: platform-wide catalogue +
 * order management (not per-organization), so it reuses the SAME system-wide
 * supervisor mechanism as CONTENT / ADVERTISEMENT / MARKET. An ACTIVE
 * assignment grants `pet_store.product.manage`, `pet_store.category.manage` and
 * `pet_store.order.manage` (see `SUPERVISOR_DOMAIN_PERMISSIONS`). Additive: the
 * check is dropped and recreated with the new value in the allowed set.
 */
const DOMAINS_BEFORE = [
  'ANIMAL',
  'CLINIC',
  'STORE',
  'CONTENT',
  'CONSULTATION',
  'INQUIRY',
  'ADVERTISEMENT',
  'MARKET',
];
const DOMAINS_AFTER = [...DOMAINS_BEFORE, 'PET_OWNER_STORE'];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${DOMAINS_AFTER.map((d) => `'${d}'`).join(', ')}))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DELETE FROM system_supervisor_assignments WHERE domain = 'PET_OWNER_STORE'`);
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${DOMAINS_BEFORE.map((d) => `'${d}'`).join(', ')}))
  `);
}
