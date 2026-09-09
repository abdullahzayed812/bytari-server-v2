import type { Knex } from 'knex';
import {
  rowToListing,
  type CreateVetServiceListingInput,
  type ListingBrowseFilter,
  type MineFilter,
  type ModerationFilter,
  type VetServiceListing,
  type VetServiceListingRow,
  type VetServiceUserSummary,
} from '../domain/vet-service.types.js';

const T = 'vet_service_listings';

interface JoinedRow extends VetServiceListingRow {
  vet_first_name: string;
  vet_last_name: string;
}

export interface VetServiceListingWithVet {
  listing: VetServiceListing;
  veterinarian: VetServiceUserSummary;
}

export class VetServiceListingRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${T} as l`)
      .join('users as u', 'u.id', 'l.veterinarian_user_id')
      .select(
        'l.*',
        'u.first_name as vet_first_name',
        'u.last_name as vet_last_name',
      );
  }

  private map(row: JoinedRow): VetServiceListingWithVet {
    return {
      listing: rowToListing(row),
      veterinarian: {
        id: row.veterinarian_user_id,
        firstName: row.vet_first_name,
        lastName: row.vet_last_name,
      },
    };
  }

  async create(
    data: CreateVetServiceListingInput & { veterinarianUserId: string },
    trx: Knex.Transaction,
  ): Promise<VetServiceListing> {
    const [row] = (await trx(T)
      .insert({
        veterinarian_user_id: data.veterinarianUserId,
        title: data.title,
        description: data.description,
        service_type: data.serviceType,
        animal_type: data.animalType,
        specialty: data.specialty ?? null,
        governorate: data.governorate,
        district: data.district ?? null,
        price_amount: data.priceAmount ?? null,
        price_type: data.priceType ?? 'APPROXIMATE',
        location_mode: data.locationMode ?? 'CLINIC',
        availability: data.availability ?? null,
        contact_phone: data.contactPhone ?? null,
        contact_whatsapp: data.contactWhatsapp ?? null,
        execution_duration: data.executionDuration ?? null,
        arrival_time: data.arrivalTime ?? null,
        details: data.details ?? [],
        image_keys: data.imageKeys ?? [],
        status: 'PENDING',
      })
      .returning('*')) as VetServiceListingRow[];
    if (!row) throw new Error('vet_service_listing insert returned no row');
    return rowToListing(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VetServiceListing | null> {
    const row = await this.conn(trx)<VetServiceListingRow>(T).where({ id }).first();
    return row ? rowToListing(row) : null;
  }

  async findWithVetById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<VetServiceListingWithVet | null> {
    const row = (await this.joined(trx).where('l.id', id).first()) as JoinedRow | undefined;
    return row ? this.map(row) : null;
  }

  async update(
    id: string,
    patch: Partial<{
      status: string;
      reviewedByUserId: string | null;
      reviewedAt: Date | null;
      rejectionReason: string | null;
      closedAt: Date | null;
    }>,
    trx: Knex.Transaction,
  ): Promise<VetServiceListing> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.reviewedByUserId !== undefined) dbPatch.reviewed_by_user_id = patch.reviewedByUserId;
    if (patch.reviewedAt !== undefined) dbPatch.reviewed_at = patch.reviewedAt;
    if (patch.rejectionReason !== undefined) dbPatch.rejection_reason = patch.rejectionReason;
    if (patch.closedAt !== undefined) dbPatch.closed_at = patch.closedAt;
    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as VetServiceListingRow[];
    if (!row) throw new Error('vet_service_listing not found on update');
    return rowToListing(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(T).where({ id }).del();
  }

  // --- listings: public browse (APPROVED, not closed) --------------

  async listPublic(
    filter: ListingBrowseFilter,
  ): Promise<{ items: VetServiceListingWithVet[]; total: number }> {
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('l.status', 'APPROVED').whereNull('l.closed_at');
      if (filter.serviceType) qb.andWhere('l.service_type', filter.serviceType);
      if (filter.animalType) qb.andWhere('l.animal_type', filter.animalType);
      if (filter.governorate) qb.andWhere('l.governorate', filter.governorate);
      if (filter.minPrice != null) qb.andWhere('l.price_amount', '>=', filter.minPrice);
      if (filter.maxPrice != null) qb.andWhere('l.price_amount', '<=', filter.maxPrice);
      if (filter.search) {
        const s = `%${filter.search}%`;
        qb.andWhere((w) => {
          w.whereILike('l.title', s)
            .orWhereILike('l.description', s)
            .orWhereILike('u.first_name', s)
            .orWhereILike('u.last_name', s);
        });
      }
      return qb;
    };
    const countRow = await scope(this.conn()(`${T} as l`).join('users as u', 'u.id', 'l.veterinarian_user_id'))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await scope(this.joined())
      .orderBy('l.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }

  // --- listings: "my listings" (every status) ---------------------

  async listMine(
    veterinarianUserId: string,
    filter: MineFilter,
  ): Promise<{ items: VetServiceListingWithVet[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('l.veterinarian_user_id', veterinarianUserId);
      if (filter.status) qb.andWhere('l.status', filter.status);
    }, filter);
  }

  async listForModeration(
    filter: ModerationFilter,
  ): Promise<{ items: VetServiceListingWithVet[]; total: number }> {
    return this.listScoped((qb) => {
      qb.andWhere('l.status', filter.status ?? 'PENDING');
    }, filter);
  }

  private async listScoped(
    scope: (qb: Knex.QueryBuilder) => void,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: VetServiceListingWithVet[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      scope(qb);
      return qb;
    };
    const countRow = await apply(this.conn()(`${T} as l`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await apply(this.joined())
      .orderBy('l.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }
}
