import { randomUUID } from 'node:crypto';
import type { DeviceToken, DeviceTokenRepository, RegisterDeviceTokenInput } from './types.js';

/**
 * In-memory {@link DeviceTokenRepository} for tests and local development.
 * The Postgres-backed adapter + migration arrive in a later phase (it FKs the
 * `users` table, which does not exist yet).
 */
export class InMemoryDeviceTokenRepository implements DeviceTokenRepository {
  private readonly byToken = new Map<string, DeviceToken>();

  register(input: RegisterDeviceTokenInput): Promise<DeviceToken> {
    const now = new Date();
    const existing = this.byToken.get(input.token);
    const record: DeviceToken = existing
      ? {
          ...existing,
          userId: input.userId,
          platform: input.platform,
          lastSeenAt: now,
          disabledAt: null,
        }
      : {
          id: randomUUID(),
          userId: input.userId,
          token: input.token,
          platform: input.platform,
          createdAt: now,
          lastSeenAt: now,
          disabledAt: null,
        };
    this.byToken.set(input.token, record);
    return Promise.resolve(record);
  }

  listActiveForUser(userId: string): Promise<DeviceToken[]> {
    const rows = [...this.byToken.values()].filter(
      (t) => t.userId === userId && t.disabledAt === null,
    );
    return Promise.resolve(rows);
  }

  removeByToken(token: string): Promise<void> {
    this.byToken.delete(token);
    return Promise.resolve();
  }

  disableTokens(tokens: string[]): Promise<void> {
    const now = new Date();
    for (const token of tokens) {
      const record = this.byToken.get(token);
      if (record) this.byToken.set(token, { ...record, disabledAt: now });
    }
    return Promise.resolve();
  }
}
