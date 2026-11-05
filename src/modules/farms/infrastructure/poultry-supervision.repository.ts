import type { Knex } from 'knex';
import { computeFarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';
import { userSearchSpec, whereTextSearch } from '../../../shared/database/search.js';
import {
  SUPERVISING_ROLE_KEYS,
  type PoultrySupervisionFarm,
  type PoultrySupervisionLinkInfo,
  type PoultrySupervisionListFilter,
  type PoultrySupervisionSummary,
  type PoultrySupervisionVeterinarian,
  type SupervisingRoleKey,
  type SupervisionType,
  type VeterinarianLinkState,
} from '../domain/poultry-supervision.types.js';
import { wherePoultryFarmGroup } from './farm-subscription-renewal.repository.js';

/** Raw rows carry storage KEYS; the service resolves them to URLs. */
export type VeterinarianRecord = Omit<PoultrySupervisionVeterinarian, 'avatarUrl'> & {
  avatarKey: string | null;
};
export type FarmRecord = Omit<PoultrySupervisionFarm, 'imageUrl'> & { imageKey: string | null };
export interface LinkRecord extends PoultrySupervisionLinkInfo {
  veterinarian: VeterinarianRecord;
  farm: FarmRecord;
}

/** A current link, resolved for the admin write actions. */
export interface CurrentLink {
  membershipId: string;
  organizationId: string;
  userId: string;
  role: SupervisingRoleKey;
}

function dateOnly(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10);
}

const VET_COLUMNS = (alias: string, prefix: string): string[] => [
  `${alias}.id as ${prefix}id`,
  `${alias}.first_name as ${prefix}first_name`,
  `${alias}.last_name as ${prefix}last_name`,
  `${alias}.email as ${prefix}email`,
  `${alias}.phone as ${prefix}phone`,
  `${alias}.whatsapp as ${prefix}whatsapp`,
  `${alias}.governorate as ${prefix}governorate`,
  `${alias}.specialization as ${prefix}specialization`,
  `${alias}.status as ${prefix}status`,
  `${alias}.avatar_key as ${prefix}avatar_key`,
  `${alias}.created_at as ${prefix}created_at`,
];

const FARM_COLUMNS = [
  'o.id as f_id',
  'o.name as f_name',
  'o.status as f_status',
  'o.created_at as f_created_at',
  'o.owner_user_id as f_owner_user_id',
  'ow.first_name as f_owner_first_name',
  'ow.last_name as f_owner_last_name',
  'ow.phone as f_owner_phone',
  'd.governorate as f_governorate',
  'd.location as f_location',
  'd.address as f_address',
  'd.contact_phone as f_contact_phone',
  'd.capacity as f_capacity',
  'd.poultry_production_type as f_production_type',
  'd.current_bird_count as f_current_bird_count',
  'd.subscription_start_date as f_subscription_start_date',
  'd.subscription_end_date as f_subscription_end_date',
  'd.image_key as f_image_key',
];

const LINK_COLUMNS = [
  'm.id as membership_id',
  'r.key as role_key',
  'm.assigned_at as assigned_at',
  'm.supervision_type as supervision_type',
  'm.supervision_notes as supervision_notes',
];

type Row = Record<string, unknown>;

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toVet(r: Row, prefix: string): VeterinarianRecord {
  return {
    userId: r[`${prefix}id`] as string,
    firstName: r[`${prefix}first_name`] as string,
    lastName: r[`${prefix}last_name`] as string,
    email: r[`${prefix}email`] as string,
    phone: (r[`${prefix}phone`] as string | null) ?? null,
    whatsapp: (r[`${prefix}whatsapp`] as string | null) ?? null,
    governorate: (r[`${prefix}governorate`] as string | null) ?? null,
    specialization: (r[`${prefix}specialization`] as string | null) ?? null,
    status: r[`${prefix}status`] as string,
    avatarKey: (r[`${prefix}avatar_key`] as string | null) ?? null,
    createdAt: (r[`${prefix}created_at`] as Date).toISOString(),
  };
}

function toFarm(r: Row): FarmRecord {
  const subscriptionStartDate = dateOnly(r.f_subscription_start_date as string | Date | null);
  const subscriptionEndDate = dateOnly(r.f_subscription_end_date as string | Date | null);
  return {
    organizationId: r.f_id as string,
    name: r.f_name as string,
    status: r.f_status as string,
    governorate: (r.f_governorate as string | null) ?? null,
    location: (r.f_location as string | null) ?? null,
    address: (r.f_address as string | null) ?? null,
    ownerUserId: r.f_owner_user_id as string,
    ownerName:
      `${(r.f_owner_first_name as string) ?? ''} ${(r.f_owner_last_name as string) ?? ''}`.trim(),
    ownerPhone: (r.f_owner_phone as string | null) ?? null,
    contactPhone: (r.f_contact_phone as string | null) ?? null,
    capacity: numOrNull(r.f_capacity),
    productionType: (r.f_production_type as string | null) ?? null,
    currentBirdCount: numOrNull(r.f_current_bird_count),
    subscriptionStartDate,
    subscriptionEndDate,
    subscriptionStatus: computeFarmSubscriptionStatus(subscriptionStartDate, subscriptionEndDate),
    imageKey: (r.f_image_key as string | null) ?? null,
    createdAt: (r.f_created_at as Date).toISOString(),
  };
}

function toLinkInfo(r: Row): PoultrySupervisionLinkInfo {
  return {
    membershipId: r.membership_id as string,
    role: r.role_key as SupervisingRoleKey,
    assignedAt: (r.assigned_at as Date).toISOString(),
    supervisionType: (r.supervision_type as SupervisionType | null) ?? null,
    notes: (r.supervision_notes as string | null) ?? null,
  };
}

/**
 * Read-only queries behind Admin "Poultry Supervisors Management". The link
 * definition lives in ONE place ({@link PoultrySupervisionRepository.linkedMemberships})
 * so every list and counter partitions consistently: a farm is either linked
 * or unlinked, a vet either linked or unlinked.
 */
export class PoultrySupervisionRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /** Live poultry farms: `organizations as o` ⋈ `farm_details as d` ⋈ owner `users as ow`. */
  private poultryFarms(trx?: Knex.Transaction): Knex.QueryBuilder {
    const conn = this.conn(trx);
    const qb = conn('organizations as o')
      .join('farm_details as d', 'd.organization_id', 'o.id')
      .join('users as ow', 'ow.id', 'o.owner_user_id')
      .where('o.type', 'FARM')
      .whereNot('o.status', 'DEACTIVATED');
    wherePoultryFarmGroup(qb, conn);
    return qb;
  }

  /** Approved, non-deleted veterinarians under `alias`. */
  private whereVeterinarian(qb: Knex.QueryBuilder, alias: string): Knex.QueryBuilder {
    return qb
      .where(`${alias}.veterinarian_status`, 'APPROVED')
      .whereNot(`${alias}.status`, 'DEACTIVATED');
  }

  /** Every current farm ↔ vet link (see `poultry-supervision.types.ts`). */
  private linkedMemberships(trx?: Knex.Transaction): Knex.QueryBuilder {
    const qb = this.poultryFarms(trx)
      .join('organization_memberships as m', 'm.organization_id', 'o.id')
      .join('organization_roles as r', 'r.id', 'm.organization_role_id')
      .join('users as v', 'v.id', 'm.user_id')
      .where('m.status', 'ACTIVE')
      .whereIn('r.key', SUPERVISING_ROLE_KEYS as unknown as string[]);
    return this.whereVeterinarian(qb, 'v');
  }

  private linkedFarmIds(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.linkedMemberships(trx).clearSelect().select('m.organization_id');
  }

  private linkedVetIds(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.linkedMemberships(trx).clearSelect().select('m.user_id');
  }

  private farmsQuery(
    linked: boolean,
    filter: Omit<PoultrySupervisionListFilter, 'page' | 'pageSize'>,
  ): Knex.QueryBuilder {
    const qb = this.poultryFarms();
    if (linked) qb.whereIn('o.id', this.linkedFarmIds());
    else qb.whereNotIn('o.id', this.linkedFarmIds());
    if (filter.governorate) qb.where('d.governorate', filter.governorate);
    // Farm name / id (any part) / location / contact, the owner, or — linked
    // farms — the supervising vet's identity.
    const term = filter.search?.trim();
    if (term) {
      qb.where((w) => {
        whereTextSearch(w, term, {
          columns: [
            'o.name',
            'o.id',
            'd.join_code',
            'd.governorate',
            'd.location',
            'd.contact_phone',
            ...userSearchSpec('ow').columns,
          ],
          fullNames: userSearchSpec('ow').fullNames,
        });
        if (linked) {
          const vetMatch = this.linkedMemberships().clearSelect().select('m.organization_id');
          whereTextSearch(vetMatch, term, {
            columns: [...userSearchSpec('v').columns, 'v.id'],
            fullNames: userSearchSpec('v').fullNames,
          });
          void w.orWhereIn('o.id', vetMatch);
        }
      });
    }
    return qb;
  }

  private vetsQuery(
    filter: Omit<PoultrySupervisionListFilter, 'page' | 'pageSize'> & {
      link?: VeterinarianLinkState;
    },
  ): Knex.QueryBuilder {
    const qb = this.whereVeterinarian(this.db('users as u'), 'u');
    if (filter.link === 'linked') qb.whereIn('u.id', this.linkedVetIds());
    if (filter.link === 'unlinked') qb.whereNotIn('u.id', this.linkedVetIds());
    if (filter.governorate) qb.where('u.governorate', filter.governorate);
    whereTextSearch(qb, filter.search, {
      columns: [...userSearchSpec('u').columns, 'u.id', 'u.governorate', 'u.specialization'],
      fullNames: userSearchSpec('u').fullNames,
    });
    return qb;
  }

  private async count(qb: Knex.QueryBuilder): Promise<number> {
    const row = await qb.count<{ count: string }>({ count: '*' }).first();
    return Number(row?.count ?? 0);
  }

  async summary(filter: { governorate?: string } = {}): Promise<PoultrySupervisionSummary> {
    const [linkedFarms, unlinkedFarms, linkedVeterinarians, unlinkedVeterinarians] =
      await Promise.all([
        this.count(this.farmsQuery(true, filter)),
        this.count(this.farmsQuery(false, filter)),
        this.count(this.vetsQuery({ ...filter, link: 'linked' })),
        this.count(this.vetsQuery({ ...filter, link: 'unlinked' })),
      ]);
    return { linkedFarms, unlinkedFarms, linkedVeterinarians, unlinkedVeterinarians };
  }

  /** Current links of the given farms, newest assignment first. */
  private async linksForFarms(organizationIds: string[]): Promise<LinkRecord[]> {
    if (organizationIds.length === 0) return [];
    const rows = (await this.linkedMemberships()
      .whereIn('o.id', organizationIds)
      .select(...LINK_COLUMNS, ...VET_COLUMNS('v', 'v_'), ...FARM_COLUMNS)
      .orderBy('m.assigned_at', 'desc')
      .orderBy('m.id', 'asc')) as Row[];
    return rows.map((r) => ({ ...toLinkInfo(r), veterinarian: toVet(r, 'v_'), farm: toFarm(r) }));
  }

  /** "الحقول المرتبطة" — paged by FARM, newest link first; each farm with its links. */
  async listLinkedFarms(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: Array<{ farm: FarmRecord; links: LinkRecord[] }>; total: number }> {
    const total = await this.count(this.farmsQuery(true, filter));
    const latest = this.db('organization_memberships as lm')
      .max('lm.assigned_at')
      .whereRaw('lm.organization_id = o.id')
      .whereIn('lm.id', this.linkedMemberships().clearSelect().select('m.id'));
    const rows = (await this.farmsQuery(true, filter)
      .select(...FARM_COLUMNS, this.db.raw('(?) as latest_assigned_at', [latest]))
      .orderBy('latest_assigned_at', 'desc')
      .orderBy('o.id', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Row[];
    const farms = rows.map(toFarm);
    const links = await this.linksForFarms(farms.map((f) => f.organizationId));
    return {
      total,
      items: farms.map((farm) => ({
        farm,
        links: links.filter((l) => l.farm.organizationId === farm.organizationId),
      })),
    };
  }

  async listUnlinkedFarms(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: FarmRecord[]; total: number }> {
    const total = await this.count(this.farmsQuery(false, filter));
    const rows = (await this.farmsQuery(false, filter)
      .select(...FARM_COLUMNS)
      .orderBy('o.created_at', 'desc')
      .orderBy('o.id', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Row[];
    return { total, items: rows.map(toFarm) };
  }

  /** "الأطباء" — approved vets (optionally only linked / unlinked) with their current links. */
  async listVeterinarians(
    filter: PoultrySupervisionListFilter & { link?: VeterinarianLinkState },
  ): Promise<{
    items: Array<{ veterinarian: VeterinarianRecord; links: LinkRecord[] }>;
    total: number;
  }> {
    const total = await this.count(this.vetsQuery(filter));
    const rows = (await this.vetsQuery(filter)
      .select(...VET_COLUMNS('u', 'v_'))
      .orderBy('u.created_at', 'desc')
      .orderBy('u.id', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Row[];
    const vets = rows.map((r) => toVet(r, 'v_'));
    const ids = vets.map((v) => v.userId);
    const linkRows =
      ids.length === 0
        ? []
        : ((await this.linkedMemberships()
            .whereIn('v.id', ids)
            .select(...LINK_COLUMNS, ...VET_COLUMNS('v', 'v_'), ...FARM_COLUMNS)
            .orderBy('m.assigned_at', 'desc')) as Row[]);
    const links: LinkRecord[] = linkRows.map((r) => ({
      ...toLinkInfo(r),
      veterinarian: toVet(r, 'v_'),
      farm: toFarm(r),
    }));
    return {
      total,
      items: vets.map((veterinarian) => ({
        veterinarian,
        links: links.filter((l) => l.veterinarian.userId === veterinarian.userId),
      })),
    };
  }

  // --- admin write-path lookups (inside the action's transaction) -------------

  /** The farm when it is a live poultry farm, else `null`. */
  async findPoultryFarm(
    organizationId: string,
    trx: Knex.Transaction,
  ): Promise<{ organizationId: string; ownerUserId: string } | null> {
    const row: { id: string; owner_user_id: string } | undefined = await this.poultryFarms(trx)
      .where('o.id', organizationId)
      .first('o.id as id', 'o.owner_user_id as owner_user_id');
    return row ? { organizationId: row.id, ownerUserId: row.owner_user_id } : null;
  }

  /** Current links of one farm (locks nothing — callers lock the farm row first). */
  async currentLinksOfFarm(organizationId: string, trx: Knex.Transaction): Promise<CurrentLink[]> {
    const rows: { id: string; user_id: string; role_key: string }[] = await this.linkedMemberships(
      trx,
    )
      .where('o.id', organizationId)
      .select('m.id as id', 'm.user_id as user_id', 'r.key as role_key');
    return rows.map((r) => ({
      membershipId: r.id,
      organizationId,
      userId: r.user_id,
      role: r.role_key as SupervisingRoleKey,
    }));
  }

  /** The membership when it is a CURRENT link, else `null`. */
  async findCurrentLink(membershipId: string, trx: Knex.Transaction): Promise<CurrentLink | null> {
    const row:
      { id: string; organization_id: string; user_id: string; role_key: string } | undefined =
      await this.linkedMemberships(trx)
        .where('m.id', membershipId)
        .first(
          'm.id as id',
          'm.organization_id as organization_id',
          'm.user_id as user_id',
          'r.key as role_key',
        );
    return row
      ? {
          membershipId: row.id,
          organizationId: row.organization_id,
          userId: row.user_id,
          role: row.role_key as SupervisingRoleKey,
        }
      : null;
  }

  /** Serialize concurrent link actions on one farm (one supervising vet per farm). */
  async lockFarm(organizationId: string, trx: Knex.Transaction): Promise<void> {
    await trx('organizations').where({ id: organizationId }).forUpdate().first('id');
  }

  /** Admin link-form details on the (just activated) membership. */
  async setLinkDetails(
    membershipId: string,
    details: { assignedAt: string; supervisionType: SupervisionType; notes: string | null },
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx('organization_memberships').where({ id: membershipId }).update({
      assigned_at: details.assignedAt,
      supervision_type: details.supervisionType,
      supervision_notes: details.notes,
      updated_at: trx.fn.now(),
    });
  }
}
