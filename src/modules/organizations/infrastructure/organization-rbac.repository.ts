import type { Knex } from 'knex';
import { pluckColumn } from '../../../shared/database/query.js';

interface OrgRoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

interface OrgPermissionRow {
  id: string;
  key: string;
  description: string | null;
}

export interface OrgRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

export interface OrgPermission {
  id: string;
  key: string;
  description: string | null;
}

export interface OrgRoleWithPermissions extends OrgRole {
  permissions: string[];
}

/**
 * Data access for the organization RBAC tables (`organization_roles`,
 * `organization_permissions`, `organization_role_permissions`,
 * `organization_supervisor_permissions`).
 */
export class OrganizationRbacRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findRoleByKey(key: string, trx?: Knex.Transaction): Promise<OrgRole | null> {
    const row = await this.conn(trx)<OrgRoleRow>('organization_roles').where({ key }).first();
    return row ? { id: row.id, key: row.key, name: row.name, description: row.description } : null;
  }

  async listRolesWithPermissions(trx?: Knex.Transaction): Promise<OrgRoleWithPermissions[]> {
    const rows = await this.conn(trx)<OrgRoleRow>('organization_roles').orderBy('key');
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: await this.getPermissionKeysForRole(r.id, trx),
      })),
    );
  }

  async listPermissions(trx?: Knex.Transaction): Promise<OrgPermission[]> {
    const rows = await this.conn(trx)<OrgPermissionRow>('organization_permissions').orderBy('key');
    return rows.map((r) => ({ id: r.id, key: r.key, description: r.description }));
  }

  async getPermissionKeysForRole(orgRoleId: string, trx?: Knex.Transaction): Promise<string[]> {
    return pluckColumn<string>(
      this.conn(trx)('organization_role_permissions as rp')
        .join('organization_permissions as p', 'p.id', 'rp.organization_permission_id')
        .where('rp.organization_role_id', orgRoleId)
        .orderBy('p.key'),
      'p.key',
    );
  }

  async getSupervisorPermissionKeys(
    membershipId: string,
    trx?: Knex.Transaction,
  ): Promise<string[]> {
    return pluckColumn<string>(
      this.conn(trx)('organization_supervisor_permissions as sp')
        .join('organization_permissions as p', 'p.id', 'sp.organization_permission_id')
        .where('sp.membership_id', membershipId)
        .orderBy('p.key'),
      'p.key',
    );
  }

  async findPermissionIdsByKeys(
    keys: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    const rows = await this.conn(trx)<OrgPermissionRow>('organization_permissions')
      .whereIn('key', keys)
      .select('id', 'key');
    return new Map(rows.map((r) => [r.key, r.id]));
  }

  /** Replace a supervisor membership's selected permissions with `permissionIds`. */
  async replaceSupervisorPermissions(
    membershipId: string,
    permissionIds: string[],
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx('organization_supervisor_permissions').where({ membership_id: membershipId }).del();
    if (permissionIds.length > 0) {
      await trx('organization_supervisor_permissions').insert(
        permissionIds.map((id) => ({
          membership_id: membershipId,
          organization_permission_id: id,
        })),
      );
    }
  }

  async clearSupervisorPermissions(membershipId: string, trx: Knex.Transaction): Promise<void> {
    await trx('organization_supervisor_permissions').where({ membership_id: membershipId }).del();
  }
}
