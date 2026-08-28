import type { Knex } from 'knex';
import { pluckColumn } from '../../shared/database/query.js';
import { rowToRole, type Role, type RoleRow } from './rbac.types.js';

/**
 * Data access for `roles`, `user_roles` and `role_permissions`.
 * Effective-permission resolution for a user also lives here (it is a pure join).
 */
export class RoleRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async listRoles(trx?: Knex.Transaction): Promise<Role[]> {
    const rows = await this.conn(trx)<RoleRow>('roles').orderBy('key');
    return rows.map(rowToRole);
  }

  async findByKey(key: string, trx?: Knex.Transaction): Promise<Role | null> {
    const row = await this.conn(trx)<RoleRow>('roles').where({ key }).first();
    return row ? rowToRole(row) : null;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Role | null> {
    const row = await this.conn(trx)<RoleRow>('roles').where({ id }).first();
    return row ? rowToRole(row) : null;
  }

  async getPermissionKeysForRole(roleId: string, trx?: Knex.Transaction): Promise<string[]> {
    return pluckColumn<string>(
      this.conn(trx)('role_permissions as rp')
        .join('permissions as p', 'p.id', 'rp.permission_id')
        .where('rp.role_id', roleId)
        .orderBy('p.key'),
      'p.key',
    );
  }

  // --- user ↔ role ----------------------------------------------------------

  async getRoleKeysForUser(userId: string, trx?: Knex.Transaction): Promise<string[]> {
    return pluckColumn<string>(
      this.conn(trx)('user_roles as ur')
        .join('roles as r', 'r.id', 'ur.role_id')
        .where('ur.user_id', userId)
        .orderBy('r.key'),
      'r.key',
    );
  }

  async getRolesForUser(userId: string, trx?: Knex.Transaction): Promise<Role[]> {
    const rows = await this.conn(trx)<RoleRow>('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where('ur.user_id', userId)
      .orderBy('r.key')
      .select('r.*');
    return rows.map(rowToRole);
  }

  async userHasRoleKey(userId: string, roleKey: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where({ 'ur.user_id': userId, 'r.key': roleKey })
      .select('ur.user_id')
      .first();
    return Boolean(row);
  }

  async assignRole(
    userId: string,
    roleId: string,
    assignedBy: string | null,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const conn = this.conn(trx);
    const existing = await conn('user_roles').where({ user_id: userId, role_id: roleId }).first();
    if (existing) return false;
    await conn('user_roles').insert({ user_id: userId, role_id: roleId, assigned_by: assignedBy });
    return true;
  }

  async removeRole(userId: string, roleId: string, trx?: Knex.Transaction): Promise<number> {
    return this.conn(trx)('user_roles').where({ user_id: userId, role_id: roleId }).del();
  }

  /** Count users holding a role, optionally only ACTIVE ones (for the last-admin guard). */
  async countUsersWithRoleKey(
    roleKey: string,
    opts: { activeOnly?: boolean } = {},
    trx?: Knex.Transaction,
  ): Promise<number> {
    const qb = this.conn(trx)('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .join('users as u', 'u.id', 'ur.user_id')
      .where('r.key', roleKey);
    if (opts.activeOnly) qb.where('u.status', 'ACTIVE');
    const row = await qb.count<{ count: string }>({ count: '*' }).first();
    return Number(row?.count ?? 0);
  }

  // --- role ↔ permission --------------------------------------------------

  async addPermissionToRole(
    roleId: string,
    permissionId: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const conn = this.conn(trx);
    const existing = await conn('role_permissions')
      .where({ role_id: roleId, permission_id: permissionId })
      .first();
    if (existing) return false;
    await conn('role_permissions').insert({ role_id: roleId, permission_id: permissionId });
    return true;
  }

  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    return this.conn(trx)('role_permissions')
      .where({ role_id: roleId, permission_id: permissionId })
      .del();
  }

  /** DISTINCT permission keys a user has via all of their roles. */
  async getPermissionKeysForUser(userId: string, trx?: Knex.Transaction): Promise<string[]> {
    const rows = (await this.conn(trx)('user_roles as ur')
      .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .join('permissions as p', 'p.id', 'rp.permission_id')
      .where('ur.user_id', userId)
      .distinct('p.key as key')
      .orderBy('key')) as { key: string }[];
    return rows.map((r) => r.key);
  }
}
