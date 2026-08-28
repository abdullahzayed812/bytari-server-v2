import type { Knex } from 'knex';
import type {
  MembershipStatus,
  OrganizationMembership,
  OrganizationMembershipRow,
  OrganizationMembershipSummary,
} from '../domain/organization.types.js';

const TABLE = 'organization_memberships';

interface JoinedRow extends OrganizationMembershipRow {
  role_key: string;
  u_email: string;
  u_first_name: string;
  u_last_name: string;
}

function toMembership(
  row: OrganizationMembershipRow & { role_key: string },
): OrganizationMembership {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    roleKey: row.role_key,
    status: row.status as MembershipStatus,
    addedBy: row.added_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSummary(row: JoinedRow): OrganizationMembershipSummary {
  return {
    ...toMembership(row),
    user: {
      id: row.user_id,
      email: row.u_email,
      firstName: row.u_first_name,
      lastName: row.u_last_name,
    },
  };
}

export interface ListMembersFilter {
  page: number;
  pageSize: number;
  status?: MembershipStatus;
  roleKey?: string;
}

export class MembershipRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private base(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${TABLE} as m`).join(
      'organization_roles as r',
      'r.id',
      'm.organization_role_id',
    );
  }

  async findByUserAndOrg(
    userId: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationMembership | null> {
    const row = (await this.base(trx)
      .where({ 'm.user_id': userId, 'm.organization_id': organizationId })
      .select('m.*', 'r.key as role_key')
      .first()) as (OrganizationMembershipRow & { role_key: string }) | undefined;
    return row ? toMembership(row) : null;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<OrganizationMembership | null> {
    const row = (await this.base(trx)
      .where('m.id', id)
      .select('m.*', 'r.key as role_key')
      .first()) as (OrganizationMembershipRow & { role_key: string }) | undefined;
    return row ? toMembership(row) : null;
  }

  /** A membership id that MUST belong to `organizationId` (IDOR guard). */
  async findByIdInOrg(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationMembership | null> {
    const row = (await this.base(trx)
      .where({ 'm.id': id, 'm.organization_id': organizationId })
      .select('m.*', 'r.key as role_key')
      .first()) as (OrganizationMembershipRow & { role_key: string }) | undefined;
    return row ? toMembership(row) : null;
  }

  async findSummaryByIdInOrg(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationMembershipSummary | null> {
    const row = (await this.base(trx)
      .join('users as u', 'u.id', 'm.user_id')
      .where({ 'm.id': id, 'm.organization_id': organizationId })
      .select(
        'm.*',
        'r.key as role_key',
        'u.email as u_email',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
      )
      .first()) as JoinedRow | undefined;
    return row ? toSummary(row) : null;
  }

  async create(
    data: {
      organizationId: string;
      userId: string;
      organizationRoleId: string;
      status?: MembershipStatus;
      addedBy: string | null;
    },
    trx?: Knex.Transaction,
  ): Promise<OrganizationMembership> {
    const [row] = await this.conn(trx)(TABLE)
      .insert({
        organization_id: data.organizationId,
        user_id: data.userId,
        organization_role_id: data.organizationRoleId,
        status: data.status ?? 'ACTIVE',
        added_by: data.addedBy,
      })
      .returning('id');
    const created = await this.findById((row as { id: string }).id, trx);
    if (!created) throw new Error('membership insert did not return a row');
    return created;
  }

  async update(
    id: string,
    patch: { organizationRoleId?: string; status?: MembershipStatus; addedBy?: string | null },
    trx?: Knex.Transaction,
  ): Promise<OrganizationMembership> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.organizationRoleId !== undefined)
      dbPatch.organization_role_id = patch.organizationRoleId;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.addedBy !== undefined) dbPatch.added_by = patch.addedBy;
    await this.conn(trx)(TABLE).where({ id }).update(dbPatch);
    const updated = await this.findById(id, trx);
    if (!updated) throw new Error('membership not found after update');
    return updated;
  }

  async listForOrg(
    organizationId: string,
    filter: ListMembersFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: OrganizationMembershipSummary[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('m.organization_id', organizationId);
      if (filter.status) qb.where('m.status', filter.status);
      if (filter.roleKey) qb.where('r.key', filter.roleKey);
      return qb;
    };

    const countRow = await apply(this.base(trx)).count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows = await apply(this.base(trx))
      .join('users as u', 'u.id', 'm.user_id')
      .orderBy('m.created_at', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select(
        'm.*',
        'r.key as role_key',
        'u.email as u_email',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
      );

    return { items: rows.map(toSummary), total };
  }

  /** Supervisor memberships (ACTIVE) of an org, with joined user info. */
  async listSupervisors(
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationMembershipSummary[]> {
    const rows = await this.base(trx)
      .join('users as u', 'u.id', 'm.user_id')
      .where({ 'm.organization_id': organizationId, 'r.key': 'SUPERVISOR', 'm.status': 'ACTIVE' })
      .orderBy('m.created_at', 'asc')
      .select(
        'm.*',
        'r.key as role_key',
        'u.email as u_email',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
      );
    return rows.map(toSummary);
  }

  /** Organizations a user has an ACTIVE membership in, with their role key. */
  async listActiveOrganizationsForUser(
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<Array<{ organizationId: string; roleKey: string }>> {
    const rows: Array<{ organization_id: string; role_key: string }> = await this.base(trx)
      .where({ 'm.user_id': userId, 'm.status': 'ACTIVE' })
      .select('m.organization_id as organization_id', 'r.key as role_key');
    return rows.map((r) => ({ organizationId: r.organization_id, roleKey: r.role_key }));
  }

  async countActiveOwners(organizationId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.base(trx)
      .where({ 'm.organization_id': organizationId, 'r.key': 'OWNER', 'm.status': 'ACTIVE' })
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }
}
