import type { Knex } from 'knex';
import {
  ORG_PERMISSION_DEFINITIONS,
  ORG_PERMISSION_KEYS,
  ORG_ROLE_DEFINITIONS,
  ORG_ROLE_KEYS,
  ORG_ROLE_PERMISSIONS,
} from '../../modules/organizations/domain/organization-rbac.constants.js';

/**
 * Deterministic, idempotent seed for the Phase 3 organization RBAC catalogue.
 * Additive — never removes rows.
 */
export async function seed(knex: Knex): Promise<void> {
  for (const key of ORG_ROLE_KEYS) {
    const def = ORG_ROLE_DEFINITIONS[key];
    await knex('organization_roles')
      .insert({ key, name: def.name, description: def.description, is_system: true })
      .onConflict('key')
      .merge({
        name: def.name,
        description: def.description,
        is_system: true,
        updated_at: knex.fn.now(),
      });
  }

  for (const key of ORG_PERMISSION_KEYS) {
    await knex('organization_permissions')
      .insert({ key, description: ORG_PERMISSION_DEFINITIONS[key] })
      .onConflict('key')
      .merge({ description: ORG_PERMISSION_DEFINITIONS[key], updated_at: knex.fn.now() });
  }

  const roleRows: Array<{ id: string; key: string }> = await knex('organization_roles')
    .whereIn('key', [...ORG_ROLE_KEYS])
    .select('id', 'key');
  const permRows: Array<{ id: string; key: string }> = await knex('organization_permissions')
    .whereIn('key', [...ORG_PERMISSION_KEYS])
    .select('id', 'key');

  const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));
  const permIdByKey = new Map(permRows.map((p) => [p.key, p.id]));

  for (const roleKey of ORG_ROLE_KEYS) {
    const roleId = roleIdByKey.get(roleKey);
    if (!roleId) continue;
    for (const permKey of ORG_ROLE_PERMISSIONS[roleKey]) {
      const permId = permIdByKey.get(permKey);
      if (!permId) continue;
      await knex('organization_role_permissions')
        .insert({ organization_role_id: roleId, organization_permission_id: permId })
        .onConflict(['organization_role_id', 'organization_permission_id'])
        .ignore();
    }
  }
}
