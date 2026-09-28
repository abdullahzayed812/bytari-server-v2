import type { Knex } from 'knex';

/**
 * Every Admin-management section can now be delegated to a system supervisor
 * (a supervisor may hold several — one row per (user, domain)): adds USERS,
 * VETERINARIANS, FARMS, SYNDICATE, TRADERS, REPORTS and NOTIFICATIONS to the
 * allowed domains. Permission sets live in `SUPERVISOR_DOMAIN_PERMISSIONS`.
 */
const BEFORE = [
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
  'VET_SERVICE',
  'VETERINARIAN_STORE',
  'VET_JOBS',
  'VET_COURSES',
];
const AFTER = [
  ...BEFORE,
  'USERS',
  'VETERINARIANS',
  'FARMS',
  'SYNDICATE',
  'TRADERS',
  'REPORTS',
  'NOTIFICATIONS',
];

async function setDomains(knex: Knex, domains: string[]): Promise<void> {
  await knex.raw(
    'ALTER TABLE system_supervisor_assignments DROP CONSTRAINT IF EXISTS chk_supervisor_domain',
  );
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${domains.map((d) => `'${d}'`).join(', ')}))
  `);
}

export async function up(knex: Knex): Promise<void> {
  await setDomains(knex, AFTER);
}

export async function down(knex: Knex): Promise<void> {
  await knex('system_supervisor_assignments').whereNotIn('domain', BEFORE).del();
  await setDomains(knex, BEFORE);
}
