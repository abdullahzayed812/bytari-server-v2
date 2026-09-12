import type { Knex } from 'knex';

const TABLE = 'organization_follows';

/** A user "following" an organization's public profile — plain join row, no extra state. */
export class OrganizationFollowRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /** Idempotent — following twice is a no-op, not a conflict. */
  async follow(organizationId: string, userId: string, trx?: Knex.Transaction): Promise<void> {
    await this.conn(trx)(TABLE)
      .insert({ organization_id: organizationId, user_id: userId })
      .onConflict(['organization_id', 'user_id'])
      .ignore();
  }

  async unfollow(organizationId: string, userId: string, trx?: Knex.Transaction): Promise<void> {
    await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId, user_id: userId })
      .delete();
  }

  async isFollowing(
    organizationId: string,
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const row = await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId, user_id: userId })
      .first();
    return Boolean(row);
  }

  async count(organizationId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId })
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  /** User ids following this organization — notification fan-out (e.g. a new syndicate announcement). */
  async listFollowerUserIds(
    organizationId: string,
    limit: number,
    trx?: Knex.Transaction,
  ): Promise<string[]> {
    const rows = (await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId })
      .limit(limit)
      .select('user_id')) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }
}
