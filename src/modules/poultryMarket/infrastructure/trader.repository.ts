import type { Knex } from 'knex';
import {
  rowToTraderProfile,
  type RegisterTraderInput,
  type TraderApplicationSummary,
  type TraderProfile,
  type TraderProfileRow,
} from '../domain/trader.types.js';
import type { TraderStatus } from '../domain/trader.constants.js';

const TABLE = 'trader_profiles';

export class TraderRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findByUserId(userId: string, trx?: Knex.Transaction): Promise<TraderProfile | null> {
    const row = await this.conn(trx)<TraderProfileRow>(TABLE).where({ user_id: userId }).first();
    return row ? rowToTraderProfile(row) : null;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<TraderProfile | null> {
    const row = await this.conn(trx)<TraderProfileRow>(TABLE).where({ id }).first();
    return row ? rowToTraderProfile(row) : null;
  }

  /** Insert a fresh profile (first-time registration). */
  async create(
    userId: string,
    input: RegisterTraderInput,
    termsAcceptedAt: Date,
    trx?: Knex.Transaction,
  ): Promise<TraderProfile> {
    const [row] = await this.conn(trx)<TraderProfileRow>(TABLE)
      .insert({
        user_id: userId,
        display_name: input.displayName,
        trader_type: input.traderType,
        governorate: input.governorate,
        district: input.district ?? null,
        phone: input.phone,
        whatsapp: input.whatsapp ?? null,
        bio: input.bio ?? null,
        terms_accepted_at: termsAcceptedAt,
        status: 'PENDING',
      })
      .returning('*');
    return rowToTraderProfile(row as TraderProfileRow);
  }

  /** Reapply: overwrite the existing profile fields and reset status to PENDING. */
  async reapply(
    userId: string,
    input: RegisterTraderInput,
    termsAcceptedAt: Date,
    trx?: Knex.Transaction,
  ): Promise<TraderProfile> {
    const [row] = await this.conn(trx)<TraderProfileRow>(TABLE)
      .where({ user_id: userId })
      .update({
        display_name: input.displayName,
        trader_type: input.traderType,
        governorate: input.governorate,
        district: input.district ?? null,
        phone: input.phone,
        whatsapp: input.whatsapp ?? null,
        bio: input.bio ?? null,
        terms_accepted_at: termsAcceptedAt,
        status: 'PENDING',
        decided_by: null,
        decided_at: null,
        decision_reason: null,
        updated_at: new Date(),
      })
      .returning('*');
    return rowToTraderProfile(row as TraderProfileRow);
  }

  async decide(
    userId: string,
    decision: { status: TraderStatus; decidedBy: string; decisionReason?: string | null },
    trx?: Knex.Transaction,
  ): Promise<TraderProfile> {
    const [row] = await this.conn(trx)<TraderProfileRow>(TABLE)
      .where({ user_id: userId })
      .update({
        status: decision.status,
        decided_by: decision.decidedBy,
        decided_at: new Date(),
        decision_reason: decision.decisionReason ?? null,
        updated_at: new Date(),
      })
      .returning('*');
    return rowToTraderProfile(row as TraderProfileRow);
  }

  async list(
    status: TraderStatus | undefined,
    page: number,
    pageSize: number,
    trx?: Knex.Transaction,
  ): Promise<{ items: TraderApplicationSummary[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)(`${TABLE} as t`).join('users as u', 'u.id', 't.user_id');
      if (status) qb.andWhere('t.status', status);
      return qb;
    };

    const countRow = await base()
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: Array<
      TraderProfileRow & { u_email: string; u_first_name: string; u_last_name: string }
    > = await base()
      .orderBy('t.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .select(
        't.*',
        'u.email as u_email',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
      );

    const items = rows.map((row) => ({
      ...rowToTraderProfile(row),
      user: {
        id: row.user_id,
        email: row.u_email,
        firstName: row.u_first_name,
        lastName: row.u_last_name,
      },
    }));

    return { items, total };
  }
}
