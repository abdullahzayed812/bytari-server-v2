import type { Knex } from 'knex';
import type {
  DeviceToken as InfraDeviceToken,
  DeviceTokenRepository as DeviceTokenPort,
  RegisterDeviceTokenInput,
} from '../../../infra/push/index.js';
import {
  rowToDeviceToken,
  type DeviceToken,
  type DeviceTokenRow,
} from '../domain/notification.types.js';

const T = 'device_push_tokens';

export interface RegisterDeviceInput {
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string | null;
  appVersion?: string | null;
}

/**
 * PostgreSQL adapter for the Phase-1 {@link DeviceTokenPort}. It also carries a
 * few user-scoped helpers the HTTP layer needs (list / remove by row id). The
 * FCM token is unique across the whole table — re-registering an existing token
 * moves ownership to the current user and clears `revoked_at`.
 */
export class DeviceTokenRepository implements DeviceTokenPort {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  // --- DeviceTokenPort (used by PushNotificationService) ------------------

  async register(input: RegisterDeviceTokenInput): Promise<InfraDeviceToken> {
    const row = await this.upsert(input);
    return {
      id: row.id,
      userId: row.userId,
      token: row.token,
      platform: row.platform,
      createdAt: new Date(row.createdAt),
      lastSeenAt: new Date(row.lastSeenAt),
      disabledAt: row.revokedAt ? new Date(row.revokedAt) : null,
    };
  }

  async listActiveForUser(userId: string): Promise<InfraDeviceToken[]> {
    const rows = await this.listForUser(userId, { includeRevoked: false });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      token: r.token,
      platform: r.platform,
      createdAt: new Date(r.createdAt),
      lastSeenAt: new Date(r.lastSeenAt),
      disabledAt: r.revokedAt ? new Date(r.revokedAt) : null,
    }));
  }

  async removeByToken(token: string): Promise<void> {
    await this.db(T).where({ token }).del();
  }

  async disableTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db(T)
      .whereIn('token', tokens)
      .whereNull('revoked_at')
      .update({ revoked_at: this.db.fn.now(), updated_at: this.db.fn.now() });
  }

  // --- user-scoped helpers (HTTP device management) --------------------

  async upsert(input: RegisterDeviceInput, trx?: Knex.Transaction): Promise<DeviceToken> {
    const now = this.conn(trx).fn.now();
    const [row] = (await this.conn(trx)(T)
      .insert({
        user_id: input.userId,
        token: input.token,
        platform: input.platform,
        device_id: input.deviceId ?? null,
        app_version: input.appVersion ?? null,
        last_seen_at: now,
      })
      .onConflict('token')
      .merge({
        user_id: input.userId,
        platform: input.platform,
        device_id: input.deviceId ?? null,
        app_version: input.appVersion ?? null,
        last_seen_at: now,
        revoked_at: null,
        updated_at: now,
      })
      .returning('*')) as DeviceTokenRow[];
    if (!row) throw new Error('device token upsert returned no row');
    return rowToDeviceToken(row);
  }

  async listForUser(
    userId: string,
    opts: { includeRevoked: boolean } = { includeRevoked: true },
    trx?: Knex.Transaction,
  ): Promise<DeviceToken[]> {
    const qb = this.conn(trx)<DeviceTokenRow>(T).where('user_id', userId);
    if (!opts.includeRevoked) qb.whereNull('revoked_at');
    const rows: DeviceTokenRow[] = await qb.orderBy('last_seen_at', 'desc');
    return rows.map(rowToDeviceToken);
  }

  async findByIdForUser(
    id: string,
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<DeviceToken | null> {
    const row = await this.conn(trx)<DeviceTokenRow>(T).where({ id, user_id: userId }).first();
    return row ? rowToDeviceToken(row) : null;
  }

  /** Hard-delete a device the caller owns (by row id). */
  async deleteByIdForUser(id: string, userId: string, trx?: Knex.Transaction): Promise<number> {
    return this.conn(trx)(T).where({ id, user_id: userId }).del();
  }
}
