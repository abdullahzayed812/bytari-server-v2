import type { Knex } from 'knex';

/**
 * Farm staff / veterinarian permissions (correction phase 2026-09-30 §5):
 *
 * - New owner-level org permission `farm.batch.sell` (selling / closing a
 *   batch) — granted to no role; OWNER override, ADMIN, or an explicit
 *   supervisor grant only.
 * - VETERINARIAN loses batch create/delete (`farm.{poultry,sheep_batch,
 *   cattle_batch}.{create,delete}`) — it keeps read/update and every
 *   operational key.
 * - STAFF gains operational create/update on daily records, expenses, health
 *   events (treatments/vaccinations), appointments and cases.
 *
 * The org RBAC seed is additive-only (it never removes a grant), so the
 * removal has to live here. Idempotent; on a fresh database the roles do not
 * exist yet and the seed applies the same state from the constants.
 */
const VET_REVOKED = [
  'farm.poultry.create',
  'farm.poultry.delete',
  'farm.sheep_batch.create',
  'farm.sheep_batch.delete',
  'farm.cattle_batch.create',
  'farm.cattle_batch.delete',
];
const STAFF_GRANTED = [
  'farm.daily_record.create',
  'farm.daily_record.update',
  'farm.expense.create',
  'farm.expense.update',
  'farm.health_event.create',
  'farm.health_event.update',
  'farm.appointment.create',
  'farm.appointment.update',
  'farm.case.create',
  'farm.case.update',
];

async function roleId(knex: Knex, key: string): Promise<string | null> {
  const row = await knex('organization_roles').where({ key }).first('id');
  return (row?.id as string | undefined) ?? null;
}

async function permissionIds(knex: Knex, keys: string[]): Promise<string[]> {
  const rows = await knex('organization_permissions').whereIn('key', keys).select('id');
  return rows.map((r: { id: string }) => r.id);
}

export async function up(knex: Knex): Promise<void> {
  await knex('organization_permissions')
    .insert({ key: 'farm.batch.sell', description: 'Sell / close a farm batch (and reopen it)' })
    .onConflict('key')
    .ignore();

  const vet = await roleId(knex, 'VETERINARIAN');
  if (vet) {
    await knex('organization_role_permissions')
      .where({ organization_role_id: vet })
      .whereIn('organization_permission_id', await permissionIds(knex, VET_REVOKED))
      .delete();
  }

  const staff = await roleId(knex, 'STAFF');
  if (staff) {
    for (const id of await permissionIds(knex, STAFF_GRANTED)) {
      await knex('organization_role_permissions')
        .insert({ organization_role_id: staff, organization_permission_id: id })
        .onConflict(['organization_role_id', 'organization_permission_id'])
        .ignore();
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  const staff = await roleId(knex, 'STAFF');
  if (staff) {
    await knex('organization_role_permissions')
      .where({ organization_role_id: staff })
      .whereIn('organization_permission_id', await permissionIds(knex, STAFF_GRANTED))
      .delete();
  }
  const vet = await roleId(knex, 'VETERINARIAN');
  if (vet) {
    for (const id of await permissionIds(knex, VET_REVOKED)) {
      await knex('organization_role_permissions')
        .insert({ organization_role_id: vet, organization_permission_id: id })
        .onConflict(['organization_role_id', 'organization_permission_id'])
        .ignore();
    }
  }
  const sell = await knex('organization_permissions').where({ key: 'farm.batch.sell' }).first('id');
  if (sell) {
    await knex('organization_supervisor_permissions')
      .where({ organization_permission_id: sell.id })
      .delete();
    await knex('organization_permissions').where({ id: sell.id }).delete();
  }
}
