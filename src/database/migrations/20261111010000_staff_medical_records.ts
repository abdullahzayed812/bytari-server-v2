import type { Knex } from 'knex';

/**
 * Clinic STAFF (employees) get the medical-record permissions by default:
 * find / open the clinic's pets (`animal.veterinary.access.read`) and read,
 * create and update medical records + vaccinations (reminders reuse the
 * `medical_record.*` keys). Deleting stays with the owner / veterinarian /
 * granted supervisor. The clinical routes are CLINIC-only, so the grant is
 * inert in other organization types. The org RBAC seed applies the same grants
 * on a fresh database; idempotent.
 */
const PERMISSIONS = [
  'animal.veterinary.access.read',
  'medical_record.read',
  'medical_record.create',
  'medical_record.update',
  'vaccination.read',
  'vaccination.create',
  'vaccination.update',
];

async function ids(knex: Knex): Promise<{ staff: string | null; perms: string[] }> {
  const staff = await knex('organization_roles').where({ key: 'STAFF' }).first('id');
  const perms = await knex('organization_permissions').whereIn('key', PERMISSIONS).select('id');
  return {
    staff: (staff?.id as string | undefined) ?? null,
    perms: perms.map((p: { id: string }) => p.id),
  };
}

export async function up(knex: Knex): Promise<void> {
  const { staff, perms } = await ids(knex);
  if (!staff || perms.length === 0) return;
  await knex('organization_role_permissions')
    .insert(perms.map((p) => ({ organization_role_id: staff, organization_permission_id: p })))
    .onConflict(['organization_role_id', 'organization_permission_id'])
    .ignore();
}

export async function down(knex: Knex): Promise<void> {
  const { staff, perms } = await ids(knex);
  if (!staff || perms.length === 0) return;
  await knex('organization_role_permissions')
    .where({ organization_role_id: staff })
    .whereIn('organization_permission_id', perms)
    .delete();
}
