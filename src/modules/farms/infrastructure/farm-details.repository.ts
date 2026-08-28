import type { Knex } from 'knex';

const TABLE = 'farm_details';

/**
 * Reads / writes the Phase 3 `farm_details` row. Phase 6 does NOT add columns —
 * only the join-code operations that were deferred from Phase 3.
 */
export class FarmDetailsRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /** Resolve a farm organization id from its join code, or `null`. */
  async findOrganizationIdByJoinCode(
    joinCode: string,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    const row = (await this.conn(trx)(TABLE)
      .where({ join_code: joinCode })
      .select('organization_id')
      .first()) as { organization_id: string } | undefined;
    return row ? row.organization_id : null;
  }

  async getJoinCode(organizationId: string, trx?: Knex.Transaction): Promise<string | null> {
    const row = (await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId })
      .select('join_code')
      .first()) as { join_code: string } | undefined;
    return row ? row.join_code : null;
  }

  /** Replace the join code. Returns rows affected (0 → not a farm / no row). */
  async setJoinCode(
    organizationId: string,
    joinCode: string,
    trx: Knex.Transaction,
  ): Promise<number> {
    return trx(TABLE)
      .where({ organization_id: organizationId })
      .update({ join_code: joinCode, updated_at: new Date() });
  }
}
