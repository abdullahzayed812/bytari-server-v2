import type { Knex } from 'knex';

/**
 * A VETERINARIAN member of a veterinary office / store may VIEW its product
 * catalogue (`product.read`) — the same read grant STAFF already has. Without
 * it a veterinarian added to an office got 403 on the office dashboard and
 * product list (both gated on `product.read`). Create / update / delete /
 * inventory stay with the OWNER (override) or an explicitly-granted
 * SUPERVISOR. The org RBAC seed applies the same grant on a fresh database;
 * idempotent.
 */
async function ids(knex: Knex): Promise<{ role: string | null; perm: string | null }> {
  const role = await knex('organization_roles').where({ key: 'VETERINARIAN' }).first('id');
  const perm = await knex('organization_permissions').where({ key: 'product.read' }).first('id');
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
