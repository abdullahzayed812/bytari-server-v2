import type { Knex } from 'knex';
import {
  rowToApplication,
  type VetApplicationStatus,
  type VetApplicationSubType,
  type VeterinarianApplicationRow,
} from './veterinarian.types.js';

const TABLE = 'veterinarian_applications';

/** An application row without its `documents` — the repository has no storage access. */
export type VeterinarianApplicationRecord = ReturnType<typeof rowToApplication>;

export interface PendingApplicationRecord extends VeterinarianApplicationRecord {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    specialization: string | null;
  };
}

export class VeterinarianRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findPendingByUser(
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplicationRecord | null> {
    const row = await this.conn(trx)<VeterinarianApplicationRow>(TABLE)
      .where({ user_id: userId, status: 'PENDING' })
      .first();
    return row ? rowToApplication(row) : null;
  }

  async findLatestByUser(
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplicationRecord | null> {
    const row = await this.conn(trx)<VeterinarianApplicationRow>(TABLE)
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .first();
    return row ? rowToApplication(row) : null;
  }

  async findById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplicationRecord | null> {
    const row = await this.conn(trx)<VeterinarianApplicationRow>(TABLE).where({ id }).first();
    return row ? rowToApplication(row) : null;
  }

  async create(
    data: { userId: string; note?: string | null; subType: VetApplicationSubType },
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplicationRecord> {
    const [row] = await this.conn(trx)<VeterinarianApplicationRow>(TABLE)
      .insert({
        user_id: data.userId,
        note: data.note ?? null,
        sub_type: data.subType,
        status: 'PENDING',
      })
      .returning('*');
    return rowToApplication(row as VeterinarianApplicationRow);
  }

  /**
   * Decide a PENDING application. Conditional on `status = 'PENDING'`, so of two
   * concurrent decisions only the first commits; the second (blocked on the row
   * lock, then re-checking the predicate) gets `null` and must abort — one
   * approval, one `veterinarian.approved` event, one email.
   */
  async decide(
    id: string,
    decision: { status: VetApplicationStatus; decidedBy: string; decisionReason?: string | null },
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplicationRecord | null> {
    const [row] = await this.conn(trx)<VeterinarianApplicationRow>(TABLE)
      .where({ id, status: 'PENDING' })
      .update({
        status: decision.status,
        decided_by: decision.decidedBy,
        decided_at: new Date(),
        decision_reason: decision.decisionReason ?? null,
        updated_at: new Date(),
      })
      .returning('*');
    return row ? rowToApplication(row) : null;
  }

  // --- approval email (exactly-once claim) ---------------------------

  /**
   * Atomically claim the approval email of an APPROVED application. `true` only
   * for the first caller — a duplicate event / retry / second node gets `false`.
   */
  async claimApprovalEmail(id: string): Promise<boolean> {
    const n = await this.db(TABLE)
      .where({ id, status: 'APPROVED' })
      .whereNull('approval_email_sent_at')
      .update({ approval_email_sent_at: new Date() });
    return n === 1;
  }

  /** Delivery failed — release the claim so the retry sweep sends it later. */
  async releaseApprovalEmail(id: string): Promise<void> {
    await this.db(TABLE).where({ id }).update({ approval_email_sent_at: null });
  }

  /** APPROVED applications decided since `since` whose email is still unsent. */
  async listApprovedAwaitingEmail(
    since: Date,
    limit: number,
  ): Promise<Array<{ id: string; userId: string }>> {
    const rows: Array<{ id: string; user_id: string }> = await this.db(TABLE)
      .where({ status: 'APPROVED' })
      .whereNull('approval_email_sent_at')
      .andWhere('decided_at', '>=', since)
      .orderBy('decided_at', 'asc')
      .limit(limit)
      .select('id', 'user_id');
    return rows.map((r) => ({ id: r.id, userId: r.user_id }));
  }

  async listPending(
    page: number,
    pageSize: number,
    trx?: Knex.Transaction,
  ): Promise<{ items: PendingApplicationRecord[]; total: number }> {
    const countRow = await this.conn(trx)(TABLE)
      .where({ status: 'PENDING' })
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: Array<
      VeterinarianApplicationRow & {
        u_email: string;
        u_first_name: string;
        u_last_name: string;
        u_phone: string | null;
        u_specialization: string | null;
      }
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
        'u.phone as u_phone',
        'u.specialization as u_specialization',
      );

    const items = rows.map((row) => {
      return {
        ...rowToApplication(row),
        user: {
          id: row.user_id,
          email: row.u_email,
          firstName: row.u_first_name,
          lastName: row.u_last_name,
          phone: row.u_phone,
          specialization: row.u_specialization,
        },
      };
    });

    return { items, total };
  }
}
