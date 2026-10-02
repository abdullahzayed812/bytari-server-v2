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

  /** Admin edit of the profile fields (status / decision untouched). */
  async updateFields(
    userId: string,
    patch: Partial<{
      displayName: string;
      traderType: string;
      governorate: string;
      district: string | null;
      phone: string;
      whatsapp: string | null;
      bio: string | null;
    }>,
    trx?: Knex.Transaction,
  ): Promise<TraderProfile> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
    if (patch.traderType !== undefined) dbPatch.trader_type = patch.traderType;
    if (patch.governorate !== undefined) dbPatch.governorate = patch.governorate;
    if (patch.district !== undefined) dbPatch.district = patch.district;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.whatsapp !== undefined) dbPatch.whatsapp = patch.whatsapp;
    if (patch.bio !== undefined) dbPatch.bio = patch.bio;
    const [row] = await this.conn(trx)<TraderProfileRow>(TABLE)
      .where({ user_id: userId })
      .update(dbPatch)
      .returning('*');
    return rowToTraderProfile(row as TraderProfileRow);
  }

  async deleteByUserId(userId: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ user_id: userId }).del();
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

  /** Set (or renew) the activation period; clears any open renewal request. */
  async setSubscription(
    userId: string,
    period: { startDate: string; endDate: string },
    trx: Knex.Transaction,
  ): Promise<TraderProfile> {
    const [row] = await trx<TraderProfileRow>(TABLE)
      .where({ user_id: userId })
      .update({
        subscription_start_date: period.startDate,
        subscription_end_date: period.endDate,
        renewal_requested_at: null,
        updated_at: new Date(),
      })
      .returning('*');
    return rowToTraderProfile(row as TraderProfileRow);
  }

  async markRenewalRequested(userId: string, trx: Knex.Transaction): Promise<TraderProfile> {
    const [row] = await trx<TraderProfileRow>(TABLE)
      .where({ user_id: userId })
      .update({ renewal_requested_at: new Date(), updated_at: new Date() })
      .returning('*');
    return rowToTraderProfile(row as TraderProfileRow);
  }

  /** Traders who asked for a renewal and wait for the admin (dashboard counter). */
  async countRenewalRequests(trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)(TABLE)
      .whereNotNull('renewal_requested_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
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

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
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

  /**
   * Admin ad review — the seller behind each offer: trader profile + account
   * name/email, keyed by user id (missing = no trader profile any more).
   */
  async findSellerSummaries(
    userIds: string[],
    trx?: Knex.Transaction,
  ): Promise<
    Map<
      string,
      {
        userId: string;
        displayName: string | null;
        traderType: string | null;
        traderStatus: string | null;
        firstName: string;
        lastName: string;
        email: string;
      }
    >
  > {
    const out = new Map<
      string,
      {
        userId: string;
        displayName: string | null;
        traderType: string | null;
        traderStatus: string | null;
        firstName: string;
        lastName: string;
        email: string;
      }
    >();
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return out;
    const rows: Array<{
      user_id: string;
      first_name: string;
      last_name: string;
      email: string;
      display_name: string | null;
      trader_type: string | null;
      trader_status: string | null;
    }> = await this.conn(trx)('users as u')
      .leftJoin(`${TABLE} as t`, 't.user_id', 'u.id')
      .whereIn('u.id', ids)
      .select(
        'u.id as user_id',
        'u.first_name',
        'u.last_name',
        'u.email',
        't.display_name',
        't.trader_type',
        't.status as trader_status',
      );
    for (const r of rows) {
      out.set(r.user_id, {
        userId: r.user_id,
        displayName: r.display_name,
        traderType: r.trader_type,
        traderStatus: r.trader_status,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
      });
    }
    return out;
  }
}
