import type { Knex } from 'knex';
import {
  rowToSyndicateDetails,
  type CreateSyndicateInput,
  type SyndicateDetails,
  type SyndicateDetailsRow,
  type UpdateSyndicateProfileInput,
} from '../domain/syndicate.types.js';

const T = 'syndicate_details';
const PINS = 'syndicate_home_pins';

export class SyndicateDetailsRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async create(
    organizationId: string,
    input: CreateSyndicateInput,
    trx: Knex.Transaction,
  ): Promise<SyndicateDetails> {
    const [row] = (await trx(T)
      .insert({
        organization_id: organizationId,
        parent_organization_id: input.parentOrganizationId ?? null,
        governorate: input.governorate ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        website: input.website ?? null,
        head_officer_name: input.headOfficerName ?? null,
        head_officer_title: input.headOfficerTitle ?? null,
        term_start_year: input.termStartYear ?? null,
        term_end_year: input.termEndYear ?? null,
      })
      .returning('*')) as SyndicateDetailsRow[];
    if (!row) throw new Error('syndicate_details insert returned no row');
    return rowToSyndicateDetails(row);
  }

  async findByOrganizationId(
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<SyndicateDetails | null> {
    const row = await this.conn(trx)<SyndicateDetailsRow>(T)
      .where({ organization_id: organizationId })
      .first();
    return row ? rowToSyndicateDetails(row) : null;
  }

  async findByOrganizationIds(
    organizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, SyndicateDetails>> {
    if (organizationIds.length === 0) return new Map();
    const rows = await this.conn(trx)<SyndicateDetailsRow>(T).whereIn(
      'organization_id',
      organizationIds,
    );
    return new Map(rows.map((r) => [r.organization_id, rowToSyndicateDetails(r)]));
  }

  async update(
    organizationId: string,
    patch: Omit<UpdateSyndicateProfileInput, 'name' | 'description'>,
    trx: Knex.Transaction,
  ): Promise<SyndicateDetails> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.governorate !== undefined) dbPatch.governorate = patch.governorate;
    if (patch.address !== undefined) dbPatch.address = patch.address;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.email !== undefined) dbPatch.email = patch.email;
    if (patch.website !== undefined) dbPatch.website = patch.website;
    if (patch.logoStorageKey !== undefined) dbPatch.logo_key = patch.logoStorageKey;
    if (patch.headOfficerName !== undefined) dbPatch.head_officer_name = patch.headOfficerName;
    if (patch.headOfficerTitle !== undefined) dbPatch.head_officer_title = patch.headOfficerTitle;
    if (patch.termStartYear !== undefined) dbPatch.term_start_year = patch.termStartYear;
    if (patch.termEndYear !== undefined) dbPatch.term_end_year = patch.termEndYear;

    const [row] = (await trx(T)
      .where({ organization_id: organizationId })
      .update(dbPatch)
      .returning('*')) as SyndicateDetailsRow[];
    if (!row) throw new Error('syndicate_details not found on update');
    return rowToSyndicateDetails(row);
  }

  /** Number of (ACTIVE) subordinate/branch syndicates under a main syndicate. */
  async countBranches(parentOrganizationId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)(`${T} as d`)
      .join('organizations as o', 'o.id', 'd.organization_id')
      .where({ 'd.parent_organization_id': parentOrganizationId, 'o.status': 'ACTIVE' })
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  /** Branches that are not deleted — blocks deleting their main syndicate. */
  async countActiveBranches(parentOrganizationId: string): Promise<number> {
    const row = await this.db(`${T} as d`)
      .join('organizations as o', 'o.id', 'd.organization_id')
      .where('d.parent_organization_id', parentOrganizationId)
      .whereNot('o.status', 'DEACTIVATED')
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  async countBranchesFor(
    parentOrganizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, number>> {
    if (parentOrganizationIds.length === 0) return new Map();
    const rows = (await this.conn(trx)(T)
      .whereIn('parent_organization_id', parentOrganizationIds)
      .groupBy('parent_organization_id')
      .select('parent_organization_id')
      .count<{ parent_organization_id: string; count: string }[]>({ count: '*' })) as {
      parent_organization_id: string;
      count: string;
    }[];
    return new Map(rows.map((r) => [r.parent_organization_id, Number(r.count)]));
  }

  /** Branch org ids of a main syndicate, optionally filtered by a text search on the org name. */
  async listBranchOrganizationIds(
    parentOrganizationId: string,
    filter: { search?: string; page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ ids: string[]; total: number }> {
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('d.parent_organization_id', parentOrganizationId).andWhere('o.status', 'ACTIVE');
      if (filter.search) {
        const s = `%${filter.search}%`;
        qb.andWhere((w) => {
          w.whereILike('o.name', s).orWhereILike('d.governorate', s).orWhereILike('d.address', s);
        });
      }
      return qb;
    };
    const base = () =>
      this.conn(trx)(`${T} as d`).join('organizations as o', 'o.id', 'd.organization_id');
    const countRow = await scope(base()).count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: { organization_id: string }[] = await scope(base())
      .orderBy('o.name', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('d.organization_id');
    return { ids: rows.map((r) => r.organization_id), total };
  }

  /** Root (main) syndicate org ids, optionally filtered by a text search on the org name. */
  async listMainOrganizationIds(
    filter: { search?: string; page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ ids: string[]; total: number }> {
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.whereNull('d.parent_organization_id').andWhere('o.status', 'ACTIVE');
      if (filter.search) {
        const s = `%${filter.search}%`;
        qb.andWhere((w) => {
          w.whereILike('o.name', s).orWhereILike('d.address', s);
        });
      }
      return qb;
    };
    const base = () =>
      this.conn(trx)(`${T} as d`).join('organizations as o', 'o.id', 'd.organization_id');
    const countRow = await scope(base()).count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: { organization_id: string }[] = await scope(base())
      .orderBy('o.name', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('d.organization_id');
    return { ids: rows.map((r) => r.organization_id), total };
  }

  // --- per-user "تثبيت النقابة" (syndicate_home_pins) ---------------

  /** Pin (now) / unpin a syndicate for ONE user. Idempotent: re-pinning keeps the original order. */
  async setUserPin(
    userId: string,
    organizationId: string,
    pinned: boolean,
    trx: Knex.Transaction,
  ): Promise<void> {
    if (pinned) {
      await trx(PINS)
        .insert({ user_id: userId, organization_id: organizationId })
        .onConflict(['user_id', 'organization_id'])
        .ignore();
    } else {
      await trx(PINS).where({ user_id: userId, organization_id: organizationId }).delete();
    }
  }

  async isPinnedBy(userId: string, organizationId: string): Promise<boolean> {
    const row = await this.db(PINS)
      .where({ user_id: userId, organization_id: organizationId })
      .first('organization_id');
    return Boolean(row);
  }

  /** The user's ACTIVE pinned syndicates (main or branch), oldest pin first — the Home section. */
  async listUserPinnedOrganizationIds(userId: string, limit: number): Promise<string[]> {
    const rows: { organization_id: string }[] = await this.db(`${PINS} as p`)
      .join('organizations as o', 'o.id', 'p.organization_id')
      .where('p.user_id', userId)
      .andWhere('o.type', 'SYNDICATE')
      .andWhere('o.status', 'ACTIVE')
      .orderBy('p.pinned_at', 'asc')
      .limit(limit)
      .select('p.organization_id');
    return rows.map((r) => r.organization_id);
  }
}
