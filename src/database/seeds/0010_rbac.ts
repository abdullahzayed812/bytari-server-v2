import type { Knex } from 'knex';
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
} from '../../modules/rbac/rbac.constants.js';

/**
 * Deterministic, idempotent seed for the Phase 2 role/permission catalogue.
 * Additive: it upserts the built-in roles/permissions and grants, but never
 * removes rows an administrator may have added at runtime.
 */
export async function seed(knex: Knex): Promise<void> {
  for (const key of ROLE_KEYS) {
    const def = ROLE_DEFINITIONS[key];
    await knex('roles')
      .insert({ key, name: def.name, description: def.description, is_system: true })
      .onConflict('key')
      .merge({
        name: def.name,
        description: def.description,
        is_system: true,
        updated_at: knex.fn.now(),
      });
  }

  for (const key of PERMISSION_KEYS) {
    await knex('permissions')
      .insert({ key, description: PERMISSION_DEFINITIONS[key] })
      .onConflict('key')
      .merge({ description: PERMISSION_DEFINITIONS[key], updated_at: knex.fn.now() });
  }

  const roleRows: Array<{ id: string; key: string }> = await knex('roles')
    .whereIn('key', [...ROLE_KEYS])
    .select('id', 'key');
  const permRows: Array<{ id: string; key: string }> = await knex('permissions')
    .whereIn('key', [...PERMISSION_KEYS])
    .select('id', 'key');

  const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));
  const permIdByKey = new Map(permRows.map((p) => [p.key, p.id]));

  for (const roleKey of ROLE_KEYS) {
    const roleId = roleIdByKey.get(roleKey);
    if (!roleId) continue;
    for (const permKey of ROLE_PERMISSIONS[roleKey]) {
      const permId = permIdByKey.get(permKey);
      if (!permId) continue;
      await knex('role_permissions')
        .insert({ role_id: roleId, permission_id: permId })
        .onConflict(['role_id', 'permission_id'])
        .ignore();
    }
  }
}
