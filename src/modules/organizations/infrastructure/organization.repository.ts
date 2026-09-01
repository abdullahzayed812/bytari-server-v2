import type { Knex } from 'knex';
import {
  rowToOrganization,
  type Organization,
  type OrganizationProfile,
  type OrganizationRow,
  type OrganizationStatus,
  type OrganizationType,
  type OrganizationWithDetails,
  type ProfileDetailRow,
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

/** Patch for a `*_details` profile row — `logoKey` maps to the `logo_key` column. */
export interface OrganizationProfilePatch {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  logoKey?: string | null;
}

export interface DiscoverWithDetailsFilter {
  /** Must be a type with profile fields — {@link OrganizationPolicy.hasProfileFields}. */
  type: OrganizationType;
  search?: string;
  near?: { lat: number; lng: number };
  page: number;
  pageSize: number;
}

export interface DiscoveredOrganization {
  organization: Organization;
  profile: OrganizationProfile & { logoKey: string | null };
  /** km, rounded to 1 decimal — only set when `near` was provided. */
  distanceKm: number | null;
}

function rowToProfile(row?: ProfileDetailRow): OrganizationProfile & { logoKey: string | null } {
  if (!row) {
    return {
      address: null,
      latitude: null,
      longitude: null,
      phone: null,
      logoUrl: null,
      logoKey: null,
    };
  }
  return {
    address: row.address,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    phone: row.phone,
    logoUrl: null,
    logoKey: row.logo_key,
  };
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
    } else {
      const row = await this.findProfileRow(org.type, id, trx);
      const profile = rowToProfile(row);
      details.address = profile.address;
      details.latitude = profile.latitude;
      details.longitude = profile.longitude;
      details.phone = profile.phone;
      // `logoUrl` is resolved by the service (needs `ObjectStorage`); the raw
      // key never leaves the repository layer.
    }
    return { ...org, details };
  }

  /** Raw `*_details` row for a profile-bearing type — `null` for FARM. */
  async findProfileRow(
    type: OrganizationType,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<ProfileDetailRow | undefined> {
    if (type === 'FARM') return undefined;
    return this.conn(trx)<ProfileDetailRow>(DETAIL_TABLE[type])
      .where({ organization_id: organizationId })
      .first();
  }

  async updateProfileFields(
    type: OrganizationType,
    organizationId: string,
    patch: OrganizationProfilePatch,
    trx: Knex.Transaction,
  ): Promise<void> {
    const dbPatch: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (patch.address !== undefined) dbPatch.address = patch.address;
    if (patch.latitude !== undefined) dbPatch.latitude = patch.latitude;
    if (patch.longitude !== undefined) dbPatch.longitude = patch.longitude;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.logoKey !== undefined) dbPatch.logo_key = patch.logoKey;
    if (Object.keys(dbPatch).length === 1) return; // nothing but updated_at — no-op

    const updated = await trx(DETAIL_TABLE[type])
      .where({ organization_id: organizationId })
      .update(dbPatch);
    if (updated === 0) throw new Error(`organization profile row not found: ${organizationId}`);
  }

  /**
   * Public directory listing for one profile-bearing type — left-joins its
   * `*_details` row and, when `near` is given, orders by great-circle
   * distance (haversine; no PostGIS). `type` must satisfy
   * `OrganizationPolicy.hasProfileFields` — the caller enforces that.
   */
  async discoverWithDetails(
    filter: DiscoverWithDetailsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: DiscoveredOrganization[]; total: number }> {
    const table = DETAIL_TABLE[filter.type];
    const conn = this.conn(trx);

    const base = (): Knex.QueryBuilder => {
      const qb = conn(`${TABLE} as o`)
        .leftJoin(`${table} as d`, 'd.organization_id', 'o.id')
        .where('o.type', filter.type)
        .where('o.status', 'ACTIVE');
      if (filter.search) {
        qb.whereRaw('lower(o.name) like ?', [`%${filter.search.toLowerCase()}%`]);
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    let query = base().select(
      'o.*',
      'd.address as d_address',
      'd.latitude as d_latitude',
      'd.longitude as d_longitude',
      'd.phone as d_phone',
      'd.logo_key as d_logo_key',
    );

    if (filter.near) {
      // Haversine great-circle distance in km, clamped into acos' domain
      // against float rounding at antipodal/identical points.
      query = query
        .select(
          conn.raw(
            `(CASE WHEN d.latitude IS NULL OR d.longitude IS NULL THEN NULL ELSE
               6371 * acos(least(1, greatest(-1,
                 cos(radians(?)) * cos(radians(d.latitude)) * cos(radians(d.longitude) - radians(?))
                 + sin(radians(?)) * sin(radians(d.latitude))
               )))
             END) as distance_km`,
            [filter.near.lat, filter.near.lng, filter.near.lat],
          ),
        )
        // Postgres default null ordering already puts NULLs last on ASC —
        // organizations with no coordinates simply sort to the end.
        .orderBy('distance_km', 'asc')
        .orderBy('o.created_at', 'desc');
    } else {
      query = query.orderBy('o.created_at', 'desc');
    }

    const rows = (await query
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Array<
      OrganizationRow & {
        d_address: string | null;
        d_latitude: number | null;
        d_longitude: number | null;
        d_phone: string | null;
        d_logo_key: string | null;
        distance_km?: string | number | null;
      }
    >;

    const items: DiscoveredOrganization[] = rows.map((row) => ({
      organization: rowToOrganization(row),
      profile: rowToProfile({
        organization_id: row.id,
        address: row.d_address,
        latitude: row.d_latitude,
        longitude: row.d_longitude,
        phone: row.d_phone,
        logo_key: row.d_logo_key,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }),
      distanceKm: row.distance_km == null ? null : Math.round(Number(row.distance_km) * 10) / 10,
    }));

    return { items, total };
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
