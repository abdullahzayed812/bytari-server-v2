import type { Knex } from 'knex';
import { pluckColumn } from '../../shared/database/query.js';
import { rowToPermission, type Permission, type PermissionRow } from './rbac.types.js';

export class PermissionRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async list(trx?: Knex.Transaction): Promise<Permission[]> {
    const rows = await this.conn(trx)<PermissionRow>('permissions').orderBy('key');
    return rows.map(rowToPermission);
  }

  async findByKey(key: string, trx?: Knex.Transaction): Promise<Permission | null> {
    const row = await this.conn(trx)<PermissionRow>('permissions').where({ key }).first();
    return row ? rowToPermission(row) : null;
  }

  async listKeys(trx?: Knex.Transaction): Promise<string[]> {
    return pluckColumn<string>(this.conn(trx)('permissions').orderBy('key'), 'key');
  }
}
