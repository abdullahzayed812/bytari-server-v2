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

  /**
   * The dashboard "Followers" page: ACTIVE accounts following this
   * organization, newest follow first — names only (no email / avatar /
   * profile data leaves this query). The organization's own active members
   * are not its audience and are left out.
   */
  async listFollowerNames(
    organizationId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: { userId: string; firstName: string; lastName: string }[]; total: number }> {
    const base = this.db(`${TABLE} as f`)
      .join('users as u', 'u.id', 'f.user_id')
      .where('f.organization_id', organizationId)
      .andWhere('u.status', 'ACTIVE')
      .whereNotExists(
        this.db('organization_memberships as m')
          .whereRaw('m.organization_id = f.organization_id')
          .andWhereRaw('m.user_id = f.user_id')
          .andWhere('m.status', 'ACTIVE'),
      );
    const countRow = (await base.clone().count<{ n: string }>({ n: '*' }).first()) as
      { n: string } | undefined;
    const rows: { user_id: string; first_name: string; last_name: string }[] = await base
      .clone()
      .orderBy('f.created_at', 'desc')
      .orderBy('f.user_id')
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize)
      .select('f.user_id', 'u.first_name', 'u.last_name');
    return {
      items: rows.map((r) => ({
        userId: r.user_id,
        firstName: r.first_name,
        lastName: r.last_name,
      })),
      total: Number(countRow?.n ?? 0),
    };
  }

  /** User ids following this organization — notification fan-out (e.g. a new syndicate announcement). */
  async listFollowerUserIds(
    organizationId: string,
    limit: number,
    trx?: Knex.Transaction,
  ): Promise<string[]> {
    const rows: { user_id: string }[] = await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId })
      .limit(limit)
      .select('user_id');
    return rows.map((r) => r.user_id);
  }
}
