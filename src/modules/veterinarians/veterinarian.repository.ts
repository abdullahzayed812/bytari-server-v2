import type { Knex } from 'knex';
import {
  rowToApplication,
  type PendingApplicationSummary,
  type VetApplicationStatus,
  type VeterinarianApplication,
  type VeterinarianApplicationRow,
} from './veterinarian.types.js';

const TABLE = 'veterinarian_applications';

export class VeterinarianRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findPendingByUser(
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplication | null> {
    const row = await this.conn(trx)<VeterinarianApplicationRow>(TABLE)
      .where({ user_id: userId, status: 'PENDING' })
      .first();
    return row ? rowToApplication(row) : null;
  }

  async findLatestByUser(
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplication | null> {
    const row = await this.conn(trx)<VeterinarianApplicationRow>(TABLE)
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .first();
    return row ? rowToApplication(row) : null;
  }

  async create(
    data: { userId: string; note?: string | null },
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplication> {
    const [row] = await this.conn(trx)<VeterinarianApplicationRow>(TABLE)
      .insert({ user_id: data.userId, note: data.note ?? null, status: 'PENDING' })
      .returning('*');
    return rowToApplication(row as VeterinarianApplicationRow);
  }

  async decide(
    id: string,
    decision: { status: VetApplicationStatus; decidedBy: string; decisionReason?: string | null },
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplication> {
    const [row] = await this.conn(trx)<VeterinarianApplicationRow>(TABLE)
      .where({ id })
      .update({
        status: decision.status,
        decided_by: decision.decidedBy,
        decided_at: new Date(),
        decision_reason: decision.decisionReason ?? null,
        updated_at: new Date(),
      })
      .returning('*');
    return rowToApplication(row as VeterinarianApplicationRow);
  }

  async listPending(
    page: number,
    pageSize: number,
    trx?: Knex.Transaction,
  ): Promise<{ items: PendingApplicationSummary[]; total: number }> {
    const countRow = await this.conn(trx)(TABLE)
      .where({ status: 'PENDING' })
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: Array<
      VeterinarianApplicationRow & { u_email: string; u_first_name: string; u_last_name: string }
    > = await this.conn(trx)(`${TABLE} as a`)
      .join('users as u', 'u.id', 'a.user_id')
      .where('a.status', 'PENDING')
      .orderBy('a.created_at', 'asc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .select(
        'a.*',
        'u.email as u_email',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
      );

    const items = rows.map((row) => {
      return {
        ...rowToApplication(row),
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
