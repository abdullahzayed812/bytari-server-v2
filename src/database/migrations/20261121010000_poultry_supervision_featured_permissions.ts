import type { Knex } from 'knex';

/**
 * Two more delegable Admin-management sections:
 *  - `poultry_supervision.manage` → domain POULTRY_SUPERVISION
 *    (Poultry Supervisors Management, previously ADMIN-role only);
 *  - `featured_organization.manage` → domain FEATURED_CLINICS
 *    (featured clinics / offices, previously under `home_section.manage`).
 * Domain → permission sets live in `SUPERVISOR_DOMAIN_PERMISSIONS`.
 * Also `veterinarian.document.manage` (ADMIN-only: replace a vet's identity
 * document), held by no role and no domain.
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
  'USERS',
  'VETERINARIANS',
  'FARMS',
  'SYNDICATE',
  'TRADERS',
  'REPORTS',
  'NOTIFICATIONS',
];
const AFTER = [...BEFORE, 'POULTRY_SUPERVISION', 'FEATURED_CLINICS'];

const PERMISSIONS = [
  {
    key: 'veterinarian.document.manage',
    description: 'Replace a veterinarian’s uploaded identity / licence documents (ADMIN only)',
  },
  {
    key: 'featured_organization.manage',
    description:
      'Add, edit, enable/disable and remove the featured clinics / offices of the home pages',
  },
  {
    key: 'poultry_supervision.manage',
    description:
      'View and manage veterinarian ↔ poultry-farm supervision links (no full-profile access)',
  },
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
  await knex('permissions').insert(PERMISSIONS).onConflict('key').ignore();
}

export async function down(knex: Knex): Promise<void> {
  await knex('permissions')
    .whereIn(
      'key',
      PERMISSIONS.map((p) => p.key),
    )
    .del();
  await knex('system_supervisor_assignments').whereNotIn('domain', BEFORE).del();
  await setDomains(knex, BEFORE);
}
