import type { Knex } from 'knex';

/**
 * Admin "Poultry Supervisors Management" can now link a veterinarian to a
 * poultry farm directly (in addition to the farm join code). The admin link
 * form records HOW the vet supervises the farm and free-text notes; both live
 * on the existing farm ↔ vet relationship (`organization_memberships`) — no
 * separate link table. NULL for every membership not created by that form
 * (join code, clinics, offices, …). The start date is the existing
 * `assigned_at` (`20261119020000_membership_assigned_at.ts`).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('organization_memberships', (t) => {
    t.text('supervision_type').nullable();
    t.text('supervision_notes').nullable();
  });
  await knex.raw(`
    ALTER TABLE organization_memberships
      ADD CONSTRAINT chk_org_membership_supervision_type
        CHECK (supervision_type IS NULL OR supervision_type IN ('WEEKLY', 'RESIDENT', 'EMERGENCY')),
      ADD CONSTRAINT chk_org_membership_supervision_notes
        CHECK (supervision_notes IS NULL OR char_length(supervision_notes) <= 1000)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE organization_memberships DROP CONSTRAINT IF EXISTS chk_org_membership_supervision_type',
  );
  await knex.raw(
    'ALTER TABLE organization_memberships DROP CONSTRAINT IF EXISTS chk_org_membership_supervision_notes',
  );
  await knex.schema.alterTable('organization_memberships', (t) => {
    t.dropColumn('supervision_type');
    t.dropColumn('supervision_notes');
  });
}
