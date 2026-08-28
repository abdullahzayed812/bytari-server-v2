import type { Knex } from 'knex';
import {
  rowToRefreshSession,
  type CreateRefreshSessionData,
  type RefreshSession,
  type RefreshSessionRow,
} from './refresh-session.types.js';

const TABLE = 'refresh_sessions';

export class RefreshSessionRepository {
  constructor(private readonly db: Knex) {}

  private table(trx?: Knex.Transaction): Knex.QueryBuilder<RefreshSessionRow> {
    return (trx ?? this.db)<RefreshSessionRow>(TABLE);
  }

  async create(data: CreateRefreshSessionData, trx?: Knex.Transaction): Promise<RefreshSession> {
    const [row] = await this.table(trx)
      .insert({
        user_id: data.userId,
        token_hash: data.tokenHash,
        expires_at: data.expiresAt,
        user_agent: data.userAgent ?? null,
        ip: data.ip ?? null,
      })
      .returning('*');
    return rowToRefreshSession(row as RefreshSessionRow);
  }

  async findByTokenHash(tokenHash: string, trx?: Knex.Transaction): Promise<RefreshSession | null> {
    const row = await this.table(trx).where({ token_hash: tokenHash }).first();
    return row ? rowToRefreshSession(row) : null;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<RefreshSession | null> {
    const row = await this.table(trx).where({ id }).first();
    return row ? rowToRefreshSession(row) : null;
  }

  async markRevoked(
    id: string,
    replacedBySessionId: string | null,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.table(trx)
      .where({ id })
      .whereNull('revoked_at')
      .update({ revoked_at: new Date(), replaced_by_session_id: replacedBySessionId });
  }

  async touch(id: string, trx?: Knex.Transaction): Promise<void> {
    await this.table(trx).where({ id }).update({ last_used_at: new Date() });
  }

  /** Revoke every live session for a user. Returns the number revoked. */
  async revokeAllForUser(userId: string, trx?: Knex.Transaction): Promise<number> {
    return this.table(trx)
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .update({ revoked_at: new Date() });
  }

  async countActiveForUser(userId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.table(trx)
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  /** Housekeeping: drop expired, already-revoked rows. Not scheduled in Phase 2. */
  async deleteExpired(before: Date, trx?: Knex.Transaction): Promise<number> {
    return this.table(trx).where('expires_at', '<', before).del();
  }
}
