import type { Knex } from 'knex';

/**
 * A SUPERVISOR member may always VIEW the organization profile
 * (`organization.read`) — the same read grant VETERINARIAN and STAFF already
 * have. Without it a supervisor whose owner ticked only e.g. the product
 * permissions got 403 on `GET /organizations/:id`, which the office / clinic
 * dashboards load first. Everything else stays per-membership. The org RBAC
 * seed applies the same grant on a fresh database; idempotent.
 */
async function ids(knex: Knex): Promise<{ role: string | null; perm: string | null }> {
  const role = await knex('organization_roles').where({ key: 'SUPERVISOR' }).first('id');
  const perm = await knex('organization_permissions')
    .where({ key: 'organization.read' })
    .first('id');
  return {
    role: (role?.id as string | undefined) ?? null,
    perm: (perm?.id as string | undefined) ?? null,
  };
}

export async function up(knex: Knex): Promise<void> {
  const { role, perm } = await ids(knex);
  if (!role || !perm) return;
  await knex('organization_role_permissions')
    .insert({ organization_role_id: role, organization_permission_id: perm })
    .onConflict(['organization_role_id', 'organization_permission_id'])
    .ignore();
}

export async function down(knex: Knex): Promise<void> {
  const { role, perm } = await ids(knex);
  if (!role || !perm) return;
  await knex('organization_role_permissions')
    .where({ organization_role_id: role, organization_permission_id: perm })
    .delete();
}
