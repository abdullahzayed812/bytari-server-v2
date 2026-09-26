import type { Knex } from 'knex';

const TABLE = 'organization_likes';

/** A user "liking" an organization's public profile — plain join row, like/unlike idempotent. */
export class OrganizationLikeRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async like(organizationId: string, userId: string, trx?: Knex.Transaction): Promise<void> {
    await this.conn(trx)(TABLE)
      .insert({ organization_id: organizationId, user_id: userId })
      .onConflict(['organization_id', 'user_id'])
      .ignore();
  }

  async unlike(organizationId: string, userId: string, trx?: Knex.Transaction): Promise<void> {
    await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId, user_id: userId })
      .delete();
  }

  async isLiked(organizationId: string, userId: string, trx?: Knex.Transaction): Promise<boolean> {
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
}
