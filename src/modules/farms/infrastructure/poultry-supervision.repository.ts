import type { Knex } from 'knex';
import { computeFarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';
import { userSearchSpec, whereTextSearch } from '../../../shared/database/search.js';
import {
  SUPERVISING_ROLE_KEYS,
  type PoultrySupervisionFarm,
  type PoultrySupervisionListFilter,
  type PoultrySupervisionSummary,
  type PoultrySupervisionVeterinarian,
  type SupervisingRoleKey,
} from '../domain/poultry-supervision.types.js';
import { wherePoultryFarmGroup } from './farm-subscription-renewal.repository.js';

/** Raw rows carry storage KEYS; the service resolves them to URLs. */
export type VeterinarianRecord = Omit<PoultrySupervisionVeterinarian, 'avatarUrl'> & {
  avatarKey: string | null;
};
export type FarmRecord = Omit<PoultrySupervisionFarm, 'imageUrl'> & { imageKey: string | null };
export interface LinkRecord {
  membershipId: string;
  role: SupervisingRoleKey;
  assignedAt: string;
  veterinarian: VeterinarianRecord;
  farm: FarmRecord;
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
  'd.current_bird_count as f_current_bird_count',
  'd.subscription_start_date as f_subscription_start_date',
  'd.subscription_end_date as f_subscription_end_date',
  'd.image_key as f_image_key',
];

type Row = Record<string, unknown>;

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
  const birds = r.f_current_bird_count as number | string | null;
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
    currentBirdCount: birds === null || birds === undefined ? null : Number(birds),
    subscriptionStartDate,
    subscriptionEndDate,
    subscriptionStatus: computeFarmSubscriptionStatus(subscriptionStartDate, subscriptionEndDate),
    imageKey: (r.f_image_key as string | null) ?? null,
    createdAt: (r.f_created_at as Date).toISOString(),
  };
}

/**
 * Read-only queries behind Admin "Poultry Supervisors Management". The link
 * definition lives in ONE place ({@link PoultrySupervisionRepository.linkedMemberships})
 * so the three lists always partition consistently: a vet is either in a
 * link row or in "unlinked veterinarians", a farm either has a link row or
 * is in "unlinked farms".
 */
export class PoultrySupervisionRepository {
  constructor(private readonly db: Knex) {}

  /** Live poultry farms: `organizations as o` ⋈ `farm_details as d` ⋈ owner `users as ow`. */
  private poultryFarms(): Knex.QueryBuilder {
    const qb = this.db('organizations as o')
      .join('farm_details as d', 'd.organization_id', 'o.id')
      .join('users as ow', 'ow.id', 'o.owner_user_id')
      .where('o.type', 'FARM')
      .whereNot('o.status', 'DEACTIVATED');
    wherePoultryFarmGroup(qb, this.db);
    return qb;
  }

  /** Approved, non-deleted veterinarians under `alias`. */
  private whereVeterinarian(qb: Knex.QueryBuilder, alias: string): Knex.QueryBuilder {
    return qb
      .where(`${alias}.veterinarian_status`, 'APPROVED')
      .whereNot(`${alias}.status`, 'DEACTIVATED');
  }

  /** Every current farm ↔ vet link (see `poultry-supervision.types.ts`). */
  private linkedMemberships(): Knex.QueryBuilder {
    const qb = this.poultryFarms()
      .join('organization_memberships as m', 'm.organization_id', 'o.id')
      .join('organization_roles as r', 'r.id', 'm.organization_role_id')
      .join('users as v', 'v.id', 'm.user_id')
      .where('m.status', 'ACTIVE')
      .whereIn('r.key', SUPERVISING_ROLE_KEYS as unknown as string[]);
    return this.whereVeterinarian(qb, 'v');
  }

  async summary(): Promise<PoultrySupervisionSummary> {
    const [linked, farms, vets] = await Promise.all([
      this.linkedMemberships().count<{ count: string }>({ count: '*' }).first(),
      this.unlinkedFarmsQuery().count<{ count: string }>({ count: '*' }).first(),
      this.unlinkedVeterinariansQuery().count<{ count: string }>({ count: '*' }).first(),
    ]);
    return {
      linked: Number(linked?.count ?? 0),
      unlinkedFarms: Number(farms?.count ?? 0),
      unlinkedVeterinarians: Number(vets?.count ?? 0),
    };
  }

  async listLinked(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: LinkRecord[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.linkedMemberships();
      // Vet identity (name / email / phone / id) or farm name / id / join code / location.
      whereTextSearch(qb, filter.search, {
        columns: [
          ...userSearchSpec('v').columns,
          'o.name',
          'd.join_code',
          'd.governorate',
          'd.location',
        ],
        fullNames: userSearchSpec('v').fullNames,
        ids: ['v.id', 'o.id', 'm.id'],
      });
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const rows = (await base()
      .select(
        'm.id as membership_id',
        'r.key as role_key',
        'm.assigned_at as assigned_at',
        ...VET_COLUMNS('v', 'v_'),
        ...FARM_COLUMNS,
      )
      .orderBy('m.assigned_at', 'desc')
      .orderBy('m.id', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Row[];
    return {
      total: Number(countRow?.count ?? 0),
      items: rows.map((r) => ({
        membershipId: r.membership_id as string,
        role: r.role_key as SupervisingRoleKey,
        assignedAt: (r.assigned_at as Date).toISOString(),
        veterinarian: toVet(r, 'v_'),
        farm: toFarm(r),
      })),
    };
  }

  private unlinkedFarmsQuery(): Knex.QueryBuilder {
    const linkedFarmIds = this.linkedMemberships().clearSelect().select('m.organization_id');
    return this.poultryFarms().whereNotIn('o.id', linkedFarmIds);
  }

  async listUnlinkedFarms(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: FarmRecord[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.unlinkedFarmsQuery();
      whereTextSearch(qb, filter.search, {
        columns: [
          'o.name',
          'd.join_code',
          'd.governorate',
          'd.location',
          'd.contact_phone',
          ...userSearchSpec('ow').columns,
        ],
        fullNames: userSearchSpec('ow').fullNames,
        ids: ['o.id', 'ow.id'],
      });
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const rows = (await base()
      .select(...FARM_COLUMNS)
      .orderBy('o.created_at', 'desc')
      .orderBy('o.id', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Row[];
    return { total: Number(countRow?.count ?? 0), items: rows.map(toFarm) };
  }

  private unlinkedVeterinariansQuery(): Knex.QueryBuilder {
    const linkedVetIds = this.linkedMemberships().clearSelect().select('m.user_id');
    return this.whereVeterinarian(this.db('users as u'), 'u').whereNotIn('u.id', linkedVetIds);
  }

  async listUnlinkedVeterinarians(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: VeterinarianRecord[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.unlinkedVeterinariansQuery();
      whereTextSearch(qb, filter.search, {
        columns: [...userSearchSpec('u').columns, 'u.governorate', 'u.specialization'],
        fullNames: userSearchSpec('u').fullNames,
        ids: ['u.id'],
      });
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const rows = (await base()
      .select(...VET_COLUMNS('u', 'v_'))
      .orderBy('u.created_at', 'desc')
      .orderBy('u.id', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Row[];
    return { total: Number(countRow?.count ?? 0), items: rows.map((r) => toVet(r, 'v_')) };
  }
}
