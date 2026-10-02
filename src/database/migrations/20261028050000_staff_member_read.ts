import type { Knex } from 'knex';

/**
 * STAFF may now LIST the organization's members (`member.read`) — a farm's
 * employees and veterinarians see each other on the farm dashboard and can
 * message each other (final corrections §9). Read only: `member.remove` /
 * `member.update` stay with the owner (and explicitly-granted supervisors).
 * The org RBAC seed applies the same grant on a fresh database; idempotent.
 */
async function ids(knex: Knex): Promise<{ staff: string | null; perm: string | null }> {
  const staff = await knex('organization_roles').where({ key: 'STAFF' }).first('id');
  const perm = await knex('organization_permissions').where({ key: 'member.read' }).first('id');
  return {
    staff: (staff?.id as string | undefined) ?? null,
    perm: (perm?.id as string | undefined) ?? null,
  };
}

export async function up(knex: Knex): Promise<void> {
  const { staff, perm } = await ids(knex);
  if (!staff || !perm) return;
  await knex('organization_role_permissions')
    .insert({ organization_role_id: staff, organization_permission_id: perm })
    .onConflict(['organization_role_id', 'organization_permission_id'])
    .ignore();
}

export async function down(knex: Knex): Promise<void> {
  const { staff, perm } = await ids(knex);
  if (!staff || !perm) return;
  await knex('organization_role_permissions')
    .where({ organization_role_id: staff, organization_permission_id: perm })
    .delete();
}
