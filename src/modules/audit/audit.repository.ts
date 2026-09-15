import type { Knex } from 'knex';
import type { AuditLogRecord, AuditLogRow, ListAuditFilter } from './audit.types.js';

const TABLE = 'audit_logs';

interface InsertAuditRow {
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
}

function rowToRecord(row: AuditLogRow): AuditLogRecord {
  const actorName = [row.actor_first_name, row.actor_last_name]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .trim();
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorName: actorName || null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata ?? {},
    ip: row.ip,
    userAgent: row.user_agent,
    requestId: row.request_id,
    createdAt: row.created_at.toISOString(),
  };
}

export class AuditRepository {
  constructor(private readonly db: Knex) {}

  private table(trx?: Knex.Transaction): Knex.QueryBuilder {
    return (trx ?? this.db)(TABLE);
  }

  async insert(row: InsertAuditRow, trx?: Knex.Transaction): Promise<string> {
    const [inserted] = await this.table(trx).insert(row).returning('id');
    return (inserted as { id: string }).id;
  }

  async list(
    filter: ListAuditFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: AuditLogRecord[]; total: number }> {
    // Columns are qualified with `TABLE.` throughout — `list()` below joins
    // `users` (for the actor's name), and `users` also has a `created_at`
    // column, so an unqualified reference would be ambiguous once joined.
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      if (filter.action) qb.where(`${TABLE}.action`, filter.action);
      if (filter.entityType) qb.where(`${TABLE}.entity_type`, filter.entityType);
      if (filter.entityId) qb.where(`${TABLE}.entity_id`, filter.entityId);
      if (filter.actorUserId) qb.where(`${TABLE}.actor_user_id`, filter.actorUserId);
      if (filter.from) qb.where(`${TABLE}.created_at`, '>=', filter.from);
      if (filter.to) qb.where(`${TABLE}.created_at`, '<=', filter.to);
      return qb;
    };

    const countRow = await apply(this.table(trx)).count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await apply(
      this.table(trx)
        .leftJoin('users', 'users.id', `${TABLE}.actor_user_id`)
        .select(
          `${TABLE}.*`,
          'users.first_name as actor_first_name',
          'users.last_name as actor_last_name',
        ),
    )
      .orderBy(`${TABLE}.created_at`, 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as AuditLogRow[];

    return { items: rows.map(rowToRecord), total };
  }
}
