import type { Knex } from 'knex';
import { computeFarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';
import {
  rowToFarmSubscriptionRenewalRequest,
  type FarmSubscriptionRenewalRequest,
  type FarmSubscriptionRenewalRequestRow,
  type ListRenewalRequestsFilter,
  type RenewalRequestStatus,
} from '../domain/farm-subscription.types.js';

const TABLE = 'farm_subscription_renewal_requests';

export interface CreateRenewalRequestData {
  organizationId: string;
  requestedByUserId: string;
  note: string | null;
  previousSubscriptionEndDate: string | null;
}

/** One farm row for the admin Poultry Farms management list. */
export interface AdminFarmListItem {
  organizationId: string;
  name: string;
  status: string;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  ownerUserId: string;
  ownerName: string;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  /** Computed server-side — see `computeFarmSubscriptionStatus`, never stored. */
  subscriptionStatus: 'NOT_STARTED' | 'ACTIVE' | 'EXPIRED';
  hasOpenRenewalRequest: boolean;
  supervisors: Array<{ userId: string; name: string }>;
  /** `POULTRY` | `SHEEP` | `CATTLE` | `MIXED` | `null` (legacy farms). */
  farmSpecies: string | null;
}

export interface ListFarmsForAdminFilter {
  page: number;
  pageSize: number;
  status?: string;
  /** Filters on the DERIVED subscription status (date comparison, not a stored column). */
  subscriptionStatus?: 'NOT_STARTED' | 'ACTIVE' | 'EXPIRED';
  /** `POULTRY` → `farm_species = 'POULTRY'`; `LIVESTOCK` → `farm_species IN ('SHEEP','CATTLE')`. */
  speciesGroup?: 'POULTRY' | 'LIVESTOCK';
}

function dateOnly(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10);
}

export class FarmSubscriptionRenewalRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<FarmSubscriptionRenewalRequest | null> {
    const row = await this.conn(trx)<FarmSubscriptionRenewalRequestRow>(TABLE)
      .where({ id })
      .first();
    return row ? rowToFarmSubscriptionRenewalRequest(row) : null;
  }

  /** The open (PENDING) renewal request for a farm, if any — enforces one-at-a-time. */
  async findPendingForOrganization(
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<FarmSubscriptionRenewalRequest | null> {
    const row = await this.conn(trx)<FarmSubscriptionRenewalRequestRow>(TABLE)
      .where({ organization_id: organizationId, status: 'PENDING' })
      .first();
    return row ? rowToFarmSubscriptionRenewalRequest(row) : null;
  }

  async create(
    data: CreateRenewalRequestData,
    trx?: Knex.Transaction,
  ): Promise<FarmSubscriptionRenewalRequest> {
    const [row] = (await this.conn(trx)(TABLE)
      .insert({
        organization_id: data.organizationId,
        requested_by_user_id: data.requestedByUserId,
        note: data.note,
        previous_subscription_end_date: data.previousSubscriptionEndDate,
      })
      .returning('*')) as FarmSubscriptionRenewalRequestRow[];
    if (!row) throw new Error('renewal request insert did not return a row');
    return rowToFarmSubscriptionRenewalRequest(row);
  }

  /**
   * Move a PENDING request to a terminal status. Returns `null` if it was no
   * longer PENDING (concurrency guard — mirrors the animal-transfer-request
   * `resolve` idiom).
   */
  async resolve(
    id: string,
    status: Exclude<RenewalRequestStatus, 'PENDING'>,
    patch: {
      decidedBy: string;
      decisionReason: string | null;
      newSubscriptionStartDate?: string | null;
      newSubscriptionEndDate?: string | null;
    },
    trx?: Knex.Transaction,
  ): Promise<FarmSubscriptionRenewalRequest | null> {
    const [row] = (await this.conn(trx)(TABLE)
      .where({ id, status: 'PENDING' })
      .update({
        status,
        decided_by: patch.decidedBy,
        decided_at: new Date(),
        decision_reason: patch.decisionReason,
        new_subscription_start_date: patch.newSubscriptionStartDate ?? null,
        new_subscription_end_date: patch.newSubscriptionEndDate ?? null,
        updated_at: new Date(),
      })
      .returning('*')) as FarmSubscriptionRenewalRequestRow[];
    return row ? rowToFarmSubscriptionRenewalRequest(row) : null;
  }

  async listForOrganization(
    organizationId: string,
    filter: ListRenewalRequestsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: FarmSubscriptionRenewalRequest[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('organization_id', organizationId);
      if (filter.status) qb.where('status', filter.status);
      return qb;
    };

    const countRow = await apply(this.conn(trx)(TABLE))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await apply(this.conn(trx)(TABLE))
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as FarmSubscriptionRenewalRequestRow[];

    return { items: rows.map(rowToFarmSubscriptionRenewalRequest), total };
  }

  /** Sets a farm's subscription period directly on `farm_details`. */
  async setSubscriptionDates(
    organizationId: string,
    dates: { startDate: string; endDate: string },
    trx: Knex.Transaction,
  ): Promise<void> {
    const updated = await trx('farm_details').where({ organization_id: organizationId }).update({
      subscription_start_date: dates.startDate,
      subscription_end_date: dates.endDate,
      updated_at: trx.fn.now(),
    });
    if (updated === 0) throw new Error(`farm_details row not found: ${organizationId}`);
  }

  /** Raw subscription dates for a farm — used to compute status / snapshot on request. */
  async getSubscriptionDates(
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<{ startDate: string | null; endDate: string | null }> {
    const row = await this.conn(trx)('farm_details')
      .where({ organization_id: organizationId })
      .first('subscription_start_date', 'subscription_end_date');
    return {
      startDate: dateOnly(row?.subscription_start_date ?? null),
      endDate: dateOnly(row?.subscription_end_date ?? null),
    };
  }

  /**
   * Admin Poultry Farms management list — organizations of type FARM joined
   * with owner name, subscription dates and derived status (as a SQL date
   * comparison, so pagination/filtering stay correct), open-renewal flag and
   * supervisor names. Mirrors the join style in
   * `OrganizationRepository.discoverWithDetails`.
   */
  async listFarmsForAdmin(
    filter: ListFarmsForAdminFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: AdminFarmListItem[]; total: number }> {
    const conn = this.conn(trx);
    const base = (): Knex.QueryBuilder => {
      const qb = conn('organizations as o')
        .join('farm_details as d', 'd.organization_id', 'o.id')
        .join('users as u', 'u.id', 'o.owner_user_id')
        .where('o.type', 'FARM');
      if (filter.status) qb.where('o.status', filter.status);
      // Clean partition so no farm request is ever unreviewable: LIVESTOCK is
      // exactly SHEEP/CATTLE; POULTRY is everything else (POULTRY, MIXED, and
      // legacy null-species farms created before the column existed).
      if (filter.speciesGroup === 'LIVESTOCK') {
        qb.whereIn('d.farm_species', ['SHEEP', 'CATTLE']);
      } else if (filter.speciesGroup === 'POULTRY') {
        qb.where((b) => {
          b.whereNull('d.farm_species').orWhereNotIn('d.farm_species', ['SHEEP', 'CATTLE']);
        });
      }
      if (filter.subscriptionStatus === 'NOT_STARTED') {
        qb.where((b) => {
          b.whereNull('d.subscription_start_date').orWhereNull('d.subscription_end_date');
        });
      } else if (filter.subscriptionStatus === 'ACTIVE') {
        qb.whereNotNull('d.subscription_end_date').whereRaw(
          'd.subscription_end_date >= CURRENT_DATE',
        );
      } else if (filter.subscriptionStatus === 'EXPIRED') {
        qb.whereNotNull('d.subscription_end_date').whereRaw(
          'd.subscription_end_date < CURRENT_DATE',
        );
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await base()
      .select(
        'o.id as organization_id',
        'o.name as name',
        'o.status as status',
        'o.decided_at as decided_at',
        'o.decision_reason as decision_reason',
        'o.created_at as created_at',
        'o.owner_user_id as owner_user_id',
        'u.first_name as owner_first_name',
        'u.last_name as owner_last_name',
        'd.subscription_start_date as subscription_start_date',
        'd.subscription_end_date as subscription_end_date',
        'd.farm_species as farm_species',
      )
      .orderBy('o.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Array<{
      organization_id: string;
      name: string;
      status: string;
      decided_at: Date | null;
      decision_reason: string | null;
      created_at: Date;
      owner_user_id: string;
      owner_first_name: string;
      owner_last_name: string;
      subscription_start_date: string | Date | null;
      subscription_end_date: string | Date | null;
      farm_species: string | null;
    }>;

    const orgIds = rows.map((r) => r.organization_id);
    const [openRequestOrgIds, supervisorsByOrg] = await Promise.all([
      this.findOpenRequestOrgIds(orgIds, trx),
      this.findSupervisorsByOrg(orgIds, trx),
    ]);

    const items: AdminFarmListItem[] = rows.map((r) => {
      const subscriptionStartDate = dateOnly(r.subscription_start_date);
      const subscriptionEndDate = dateOnly(r.subscription_end_date);
      return {
        organizationId: r.organization_id,
        name: r.name,
        status: r.status,
        decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
        decisionReason: r.decision_reason,
        createdAt: r.created_at.toISOString(),
        ownerUserId: r.owner_user_id,
        ownerName: `${r.owner_first_name} ${r.owner_last_name}`.trim(),
        subscriptionStartDate,
        subscriptionEndDate,
        subscriptionStatus: computeFarmSubscriptionStatus(subscriptionStartDate, subscriptionEndDate),
        hasOpenRenewalRequest: openRequestOrgIds.has(r.organization_id),
        supervisors: supervisorsByOrg.get(r.organization_id) ?? [],
        farmSpecies: r.farm_species,
      };
    });

    return { items, total };
  }

  private async findOpenRequestOrgIds(
    organizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Set<string>> {
    if (organizationIds.length === 0) return new Set();
    const rows = await this.conn(trx)<{ organization_id: string }>(TABLE)
      .whereIn('organization_id', organizationIds)
      .where('status', 'PENDING')
      .select('organization_id');
    return new Set(rows.map((r) => r.organization_id));
  }

  private async findSupervisorsByOrg(
    organizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, Array<{ userId: string; name: string }>>> {
    const byOrg = new Map<string, Array<{ userId: string; name: string }>>();
    if (organizationIds.length === 0) return byOrg;
    const rows = await this.conn(trx)('organization_memberships as m')
      .join('organization_roles as r', 'r.id', 'm.organization_role_id')
      .join('users as u', 'u.id', 'm.user_id')
      .whereIn('m.organization_id', organizationIds)
      .where('r.key', 'SUPERVISOR')
      .where('m.status', 'ACTIVE')
      .select(
        'm.organization_id as organization_id',
        'm.user_id as user_id',
        'u.first_name as first_name',
        'u.last_name as last_name',
      );
    for (const row of rows as Array<{
      organization_id: string;
      user_id: string;
      first_name: string;
      last_name: string;
    }>) {
      const list = byOrg.get(row.organization_id) ?? [];
      list.push({ userId: row.user_id, name: `${row.first_name} ${row.last_name}`.trim() });
      byOrg.set(row.organization_id, list);
    }
    return byOrg;
  }
}
