import type { Knex } from 'knex';
import {
  computeFarmSubscriptionStatus,
  type OrganizationType,
} from '../../organizations/domain/organization.types.js';
import {
  rowToFarmSubscriptionRenewalRequest,
  type FarmSubscriptionRenewalRequest,
  type FarmSubscriptionRenewalRequestRow,
  type ListRenewalRequestsFilter,
  type RenewalRequestStatus,
} from '../domain/farm-subscription.types.js';

import { userSearchSpec, whereTextSearch } from '../../../shared/database/search.js';
import {
  SUBSCRIPTION_DETAILS_TABLE,
  whereSubscriptionStatus,
} from '../../organizations/infrastructure/subscription-status-sql.js';

const TABLE = 'farm_subscription_renewal_requests';

/**
 * `farm_subscription_renewal_requests` is keyed purely by `organization_id` — no farm-specific
 * column — so it is reused unchanged for VETERINARY_OFFICE / CLINIC subscriptions (Veterinary
 * Office Dashboard spec §3: reuse the Farm approval/subscription infrastructure rather than
 * duplicating it). Only the subscription DATES live on a type-specific `*_details` table, so
 * `setSubscriptionDates`/`getSubscriptionDates` resolve the right one per organization.
 */
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
  /** Owner contact — admin-only route, never on public DTOs. */
  ownerEmail: string | null;
  ownerPhone: string | null;
  /** The farm's own profile (`farm_details`) — what the owner entered at registration. */
  governorate: string | null;
  location: string | null;
  address: string | null;
  capacity: number | null;
  establishedOn: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  poultryProductionType: string | null;
  sheepProductionType: string | null;
  cattleProductionType: string | null;
  currentBirdCount: number | null;
  currentSheepCount: number | null;
  currentCattleCount: number | null;
  /** Open (ACTIVE) flocks / batches and ACTIVE members. */
  poultryFlockCount: number;
  sheepBatchCount: number;
  cattleBatchCount: number;
  memberCount: number;
  /**
   * Raw R2 key of the farm photo (`farm_details.image_key`). The controller
   * resolves it to `imageUrl` — the key itself never reaches a client.
   */
  imageKey: string | null;
}

export interface ListFarmsForAdminFilter {
  page: number;
  pageSize: number;
  status?: string;
  /** Filters on the DERIVED subscription status (date comparison, not a stored column). */
  subscriptionStatus?: 'NOT_STARTED' | 'ACTIVE' | 'EXPIRED';
  /** See `adminListFarmsQuerySchema.speciesGroup`. */
  speciesGroup?: 'POULTRY' | 'LIVESTOCK' | 'SHEEP' | 'CATTLE';
  /**
   * `PENDING` → only farms with an open renewal request. At most one PENDING
   * request exists per organization (`uq_farm_renewal_requests_one_pending`),
   * so this `total` IS the number of pending requests in the section — the
   * dashboard counter and the "طلبات التجديد" tab share this one definition.
   */
  renewal?: 'PENDING';
  search?: string;
}

function numOrNull(v: number | string | null): number | null {
  return v === null ? null : Number(v);
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

  /** Resolves which `*_details` table holds this organization's subscription dates. */
  private async detailsTable(organizationId: string, trx?: Knex.Transaction): Promise<string> {
    const org = await this.conn(trx)('organizations').where({ id: organizationId }).first('type');
    const table = org && SUBSCRIPTION_DETAILS_TABLE[org.type as string];
    if (!table) {
      throw new Error(`Organization ${organizationId} does not support a subscription window`);
    }
    return table;
  }

  /**
   * Sets an organization's subscription period on its type's `*_details` table.
   *
   * Activating a new period after an earlier one has already ENDED means the
   * organization has left its first (free-trial) period: `free_trial_ended_at`
   * is stamped once and never cleared, so the free-trial card stays hidden
   * through every later renewal / expiration. Correcting the dates of a
   * still-running (or never-started) first period does not stamp it.
   */
  async setSubscriptionDates(
    organizationId: string,
    dates: { startDate: string; endDate: string },
    trx: Knex.Transaction,
  ): Promise<void> {
    const table = await this.detailsTable(organizationId, trx);
    const previous = await this.getSubscriptionDates(organizationId, trx);
    const previousEnded =
      computeFarmSubscriptionStatus(previous.startDate, previous.endDate) === 'EXPIRED';
    const updated = await trx(table)
      .where({ organization_id: organizationId })
      .update({
        subscription_start_date: dates.startDate,
        subscription_end_date: dates.endDate,
        ...(previousEnded
          ? { free_trial_ended_at: trx.raw('coalesce(free_trial_ended_at, now())') }
          : {}),
        updated_at: trx.fn.now(),
      });
    if (updated === 0) throw new Error(`${table} row not found: ${organizationId}`);
  }

  /** Raw subscription dates for an organization — used to compute status / snapshot on request. */
  async getSubscriptionDates(
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<{ startDate: string | null; endDate: string | null }> {
    const table = await this.detailsTable(organizationId, trx);
    const row = await this.conn(trx)(table)
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
      // An admin-deleted farm (soft delete → DEACTIVATED) leaves the default
      // list; it is still reachable with an explicit `status=DEACTIVATED`.
      if (filter.status) qb.where('o.status', filter.status);
      else qb.whereNot('o.status', 'DEACTIVATED');
      // Species partition. A MIXED farm shows under every species it really
      // holds; one with no batch/flock yet (and legacy null-species farms)
      // stays under POULTRY, so no farm request is ever unreviewable.
      const holds = (table: string): Knex.QueryBuilder =>
        conn(table).select(conn.raw('1')).whereRaw(`${table}.organization_id = o.id`);
      const mixedHolding = (b: Knex.QueryBuilder, tables: string[]): void => {
        void b.where('d.farm_species', 'MIXED').andWhere((m) => {
          for (const t of tables) void m.orWhereExists(holds(t));
        });
      };
      if (filter.speciesGroup === 'SHEEP' || filter.speciesGroup === 'CATTLE') {
        const species = filter.speciesGroup;
        const table = species === 'SHEEP' ? 'sheep_batches' : 'cattle_batches';
        qb.where((b) => {
          void b.where('d.farm_species', species).orWhere((m) => {
            mixedHolding(m, [table]);
          });
        });
      } else if (filter.speciesGroup === 'LIVESTOCK') {
        qb.where((b) => {
          void b.whereIn('d.farm_species', ['SHEEP', 'CATTLE']).orWhere((m) => {
            mixedHolding(m, ['sheep_batches', 'cattle_batches']);
          });
        });
      } else if (filter.speciesGroup === 'POULTRY') {
        qb.where((b) => {
          void b
            .whereNull('d.farm_species')
            .orWhere('d.farm_species', 'POULTRY')
            .orWhere((m) => {
              mixedHolding(m, ['poultry_flocks']);
            })
            .orWhere((m) => {
              void m
                .where('d.farm_species', 'MIXED')
                .whereNotExists(holds('sheep_batches'))
                .whereNotExists(holds('cattle_batches'));
            });
        });
      }
      // Farm name / id / join code / location / contact, or the owner's identity.
      whereTextSearch(qb, filter.search, {
        columns: [
          'o.name',
          'd.join_code',
          'd.governorate',
          'd.location',
          'd.contact_name',
          'd.contact_phone',
          'd.contact_email',
          ...userSearchSpec('u').columns,
        ],
        fullNames: userSearchSpec('u').fullNames,
        ids: ['o.id', 'u.id'],
      });
      if (filter.renewal === 'PENDING') {
        qb.whereExists((sub) => {
          void sub
            .select(conn.raw('1'))
            .from(`${TABLE} as rr`)
            .whereRaw('rr.organization_id = o.id')
            .where('rr.status', 'PENDING');
        });
      }
      if (filter.subscriptionStatus) whereSubscriptionStatus(qb, 'd', filter.subscriptionStatus);
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
        'd.image_key as image_key',
        'u.email as owner_email',
        'u.phone as owner_phone',
        'd.governorate',
        'd.location',
        'd.address',
        'd.capacity',
        'd.established_on',
        'd.contact_name',
        'd.contact_phone',
        'd.contact_email',
        'd.poultry_production_type',
        'd.sheep_production_type',
        'd.cattle_production_type',
        'd.current_bird_count',
        'd.current_sheep_count',
        'd.current_cattle_count',
        conn.raw(
          "(SELECT count(*) FROM poultry_flocks f WHERE f.organization_id = o.id AND f.status = 'ACTIVE')::int AS poultry_flock_count",
        ),
        conn.raw(
          "(SELECT count(*) FROM sheep_batches b WHERE b.organization_id = o.id AND b.status = 'ACTIVE')::int AS sheep_batch_count",
        ),
        conn.raw(
          "(SELECT count(*) FROM cattle_batches b WHERE b.organization_id = o.id AND b.status = 'ACTIVE')::int AS cattle_batch_count",
        ),
        conn.raw(
          "(SELECT count(*) FROM organization_memberships m WHERE m.organization_id = o.id AND m.status = 'ACTIVE')::int AS member_count",
        ),
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
      image_key: string | null;
      owner_email: string | null;
      owner_phone: string | null;
      governorate: string | null;
      location: string | null;
      address: string | null;
      capacity: number | string | null;
      established_on: string | Date | null;
      contact_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      poultry_production_type: string | null;
      sheep_production_type: string | null;
      cattle_production_type: string | null;
      current_bird_count: number | string | null;
      current_sheep_count: number | string | null;
      current_cattle_count: number | string | null;
      poultry_flock_count: number;
      sheep_batch_count: number;
      cattle_batch_count: number;
      member_count: number;
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
        subscriptionStatus: computeFarmSubscriptionStatus(
          subscriptionStartDate,
          subscriptionEndDate,
        ),
        hasOpenRenewalRequest: openRequestOrgIds.has(r.organization_id),
        supervisors: supervisorsByOrg.get(r.organization_id) ?? [],
        farmSpecies: r.farm_species,
        imageKey: r.image_key,
        ownerEmail: r.owner_email,
        ownerPhone: r.owner_phone,
        governorate: r.governorate,
        location: r.location,
        address: r.address,
        capacity: numOrNull(r.capacity),
        establishedOn: dateOnly(r.established_on),
        contactName: r.contact_name,
        contactPhone: r.contact_phone,
        contactEmail: r.contact_email,
        poultryProductionType: r.poultry_production_type,
        sheepProductionType: r.sheep_production_type,
        cattleProductionType: r.cattle_production_type,
        currentBirdCount: numOrNull(r.current_bird_count),
        currentSheepCount: numOrNull(r.current_sheep_count),
        currentCattleCount: numOrNull(r.current_cattle_count),
        poultryFlockCount: Number(r.poultry_flock_count),
        sheepBatchCount: Number(r.sheep_batch_count),
        cattleBatchCount: Number(r.cattle_batch_count),
        memberCount: Number(r.member_count),
      };
    });

    return { items, total };
  }

  /**
   * Every PENDING renewal request across ALL organizations (not scoped to one
   * org, unlike {@link listForOrganization}) — backs the admin dashboard's
   * cross-cutting "pending tasks" list. `farm_subscription_renewal_requests`
   * has no organization-type column, so this reuses unchanged for FARM /
   * VETERINARY_OFFICE / CLINIC subscription requests alike; `organizationType`
   * filters the join to one type (e.g. the "المكاتب" admin screen only wants
   * VETERINARY_OFFICE requests, never CLINIC/FARM ones mixed in).
   */
  async listAllPendingForAdmin(
    filter: {
      page: number;
      pageSize: number;
      organizationType?: OrganizationType;
      search?: string;
    },
    trx?: Knex.Transaction,
  ): Promise<{
    items: Array<
      FarmSubscriptionRenewalRequest & { organizationName: string; organizationType: string }
    >;
    total: number;
  }> {
    const conn = this.conn(trx);
    const base = (): Knex.QueryBuilder => {
      const qb = conn(`${TABLE} as req`)
        .join('organizations as o', 'o.id', 'req.organization_id')
        .where('req.status', 'PENDING')
        // An admin-deleted (DEACTIVATED) organization's request is not
        // actionable — same exclusion as the default farms list.
        .whereNot('o.status', 'DEACTIVATED');
      whereTextSearch(qb, filter.search, { columns: ['o.name'], ids: ['o.id', 'req.id'] });
      return filter.organizationType ? qb.where('o.type', filter.organizationType) : qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await base()
      .select('req.*', 'o.name as organization_name', 'o.type as organization_type')
      .orderBy('req.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Array<
      FarmSubscriptionRenewalRequestRow & { organization_name: string; organization_type: string }
    >;

    return {
      items: rows.map((r) => ({
        ...rowToFarmSubscriptionRenewalRequest(r),
        organizationName: r.organization_name,
        organizationType: r.organization_type,
      })),
      total,
    };
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
