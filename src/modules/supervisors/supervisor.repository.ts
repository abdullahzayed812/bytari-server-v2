import type { Knex } from 'knex';
import {
  rowToAssignment,
  type ListSupervisorFilter,
  type SupervisorAssignment,
  type SupervisorAssignmentRow,
  type SupervisorAssignmentSummary,
} from './supervisor.types.js';

const TABLE = 'system_supervisor_assignments';

export class SupervisorRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<SupervisorAssignment | null> {
    const row = await this.conn(trx)<SupervisorAssignmentRow>(TABLE).where({ id }).first();
    return row ? rowToAssignment(row) : null;
  }

  async findByUserAndDomain(
    userId: string,
    domain: string,
    trx?: Knex.Transaction,
  ): Promise<SupervisorAssignment | null> {
    const row = await this.conn(trx)<SupervisorAssignmentRow>(TABLE)
      .where({ user_id: userId, domain })
      .orderByRaw("case when status = 'ACTIVE' then 0 else 1 end")
      .first();
    return row ? rowToAssignment(row) : null;
  }

  async create(
    data: { userId: string; domain: string; assignedBy: string | null },
    trx?: Knex.Transaction,
  ): Promise<SupervisorAssignment> {
    const [row] = await this.conn(trx)<SupervisorAssignmentRow>(TABLE)
      .insert({
        user_id: data.userId,
        domain: data.domain,
        assigned_by: data.assignedBy,
        status: 'ACTIVE',
      })
      .returning('*');
    return rowToAssignment(row as SupervisorAssignmentRow);
  }

  async setStatus(
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    assignedBy: string | null,
    trx?: Knex.Transaction,
  ): Promise<SupervisorAssignment> {
    const patch: Record<string, unknown> = { status, updated_at: new Date() };
    if (status === 'ACTIVE') patch.assigned_by = assignedBy;
    const [row] = await this.conn(trx)<SupervisorAssignmentRow>(TABLE)
      .where({ id })
      .update(patch)
      .returning('*');
    return rowToAssignment(row as SupervisorAssignmentRow);
  }

  async getActiveDomainsForUser(userId: string, trx?: Knex.Transaction): Promise<string[]> {
    const rows: Array<{ domain: string }> = await this.conn(trx)(TABLE)
      .where({ user_id: userId, status: 'ACTIVE' })
      .orderBy('domain')
      .select('domain');
    return rows.map((r) => r.domain);
  }

  async list(
    filter: ListSupervisorFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: SupervisorAssignmentSummary[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      if (filter.domain) qb.where('a.domain', filter.domain);
      if (filter.userId) qb.where('a.user_id', filter.userId);
      if (filter.status) qb.where('a.status', filter.status);
      return qb;
    };

    const countRow = await apply(this.conn(trx)(`${TABLE} as a`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: Array<
      SupervisorAssignmentRow & { u_email: string; u_first_name: string; u_last_name: string }
    > = await apply(this.conn(trx)(`${TABLE} as a`))
      .join('users as u', 'u.id', 'a.user_id')
      .orderBy('a.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select(
        'a.*',
        'u.email as u_email',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
      );

    const items = rows.map((row) => {
      return {
        ...rowToAssignment(row),
        user: {
          id: row.user_id,
          email: row.u_email,
          firstName: row.u_first_name,
          lastName: row.u_last_name,
        },
      };
    });

    return { items, total };
  }
}
