import type { Knex } from 'knex';
import {
  rowToOrganization,
  type Organization,
  type OrganizationRow,
  type OrganizationStatus,
  type OrganizationType,
  type OrganizationWithDetails,
} from '../domain/organization.types.js';

const TABLE = 'organizations';

const DETAIL_TABLE: Record<OrganizationType, string> = {
  CLINIC: 'clinic_details',
  FARM: 'farm_details',
  VETERINARY_OFFICE: 'veterinary_office_details',
  VETERINARY_STORE: 'veterinary_store_details',
};

export interface CreateOrganizationData {
  type: OrganizationType;
  name: string;
  description: string | null;
  ownerUserId: string;
}

export interface ListOrganizationsFilter {
  page: number;
  pageSize: number;
  type?: OrganizationType;
  status?: OrganizationStatus;
  ownerUserId?: string;
  search?: string;
}

export class OrganizationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Organization | null> {
    const row = await this.conn(trx)<OrganizationRow>(TABLE).where({ id }).first();
    return row ? rowToOrganization(row) : null;
  }

  async findByIdWithDetails(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationWithDetails | null> {
    const org = await this.findById(id, trx);
    if (!org) return null;
    const details: OrganizationWithDetails['details'] = {};
    if (org.type === 'FARM') {
      const row = (await this.conn(trx)('farm_details').where({ organization_id: id }).first()) as
        { join_code: string } | undefined;
      if (row) details.joinCode = row.join_code;
    }
    return { ...org, details };
  }

  async create(data: CreateOrganizationData, trx: Knex.Transaction): Promise<Organization> {
    const [row] = (await trx(TABLE)
      .insert({
        type: data.type,
        name: data.name,
        description: data.description,
        owner_user_id: data.ownerUserId,
        status: 'PENDING',
      })
      .returning('*')) as OrganizationRow[];
    if (!row) throw new Error('organization insert did not return a row');
    return rowToOrganization(row);
  }

  async insertDetails(
    type: OrganizationType,
    organizationId: string,
    extra: Record<string, unknown>,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(DETAIL_TABLE[type]).insert({ organization_id: organizationId, ...extra });
  }

  async updateStatus(
    id: string,
    patch: {
      status: OrganizationStatus;
      decidedBy?: string | null;
      decisionReason?: string | null;
    },
    trx: Knex.Transaction,
  ): Promise<Organization> {
    const dbPatch: Record<string, unknown> = { status: patch.status, updated_at: new Date() };
    if (patch.decidedBy !== undefined) {
      dbPatch.decided_by = patch.decidedBy;
      dbPatch.decided_at = new Date();
    }
    if (patch.decisionReason !== undefined) dbPatch.decision_reason = patch.decisionReason;
    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as OrganizationRow[];
    if (!row) throw new Error('organization not found after status update');
    return rowToOrganization(row);
  }

  async update(
    id: string,
    patch: { name?: string; description?: string | null },
    trx?: Knex.Transaction,
  ): Promise<Organization> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    const [row] = (await this.conn(trx)(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as OrganizationRow[];
    if (!row) throw new Error('organization not found after update');
    return rowToOrganization(row);
  }

  async list(
    filter: ListOrganizationsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: Organization[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      if (filter.type) qb.where('type', filter.type);
      if (filter.status) qb.where('status', filter.status);
      if (filter.ownerUserId) qb.where('owner_user_id', filter.ownerUserId);
      if (filter.search) {
        qb.whereRaw('lower(name) like ?', [`%${filter.search.toLowerCase()}%`]);
      }
      return qb;
    };

    const countRow = await apply(this.conn(trx)(TABLE))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await apply(this.conn(trx)(TABLE))
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as OrganizationRow[];

    return { items: rows.map(rowToOrganization), total };
  }

  /** Organizations by id set (for "my organizations" listing). */
  async findManyByIds(ids: string[], trx?: Knex.Transaction): Promise<Organization[]> {
    if (ids.length === 0) return [];
    const rows = await this.conn(trx)<OrganizationRow>(TABLE)
      .whereIn('id', ids)
      .orderBy('created_at', 'desc');
    return rows.map(rowToOrganization);
  }
}
