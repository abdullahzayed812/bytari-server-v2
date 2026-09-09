import type { Knex } from 'knex';
import {
  rowToListingRequest,
  type CreateVetServiceListingRequestInput,
  type EngagementListFilter,
  type VetServiceListingRequest,
  type VetServiceListingRequestRow,
  type VetServiceUserSummary,
} from '../domain/vet-service.types.js';
import type {
  VetServiceAnimalType,
  VetServiceType,
} from '../domain/vet-service.constants.js';

const T = 'vet_service_listing_requests';

interface JoinedRow extends VetServiceListingRequestRow {
  owner_first_name: string;
  owner_last_name: string;
  lst_title: string;
  lst_service_type: string;
  lst_animal_type: string;
  lst_vet_user_id: string;
  lst_price_amount: string | null;
}

export interface VetServiceListingRequestJoined {
  listingRequest: VetServiceListingRequest;
  petOwner: VetServiceUserSummary;
  listing: {
    id: string;
    title: string;
    serviceType: VetServiceType;
    animalType: VetServiceAnimalType;
    veterinarianUserId: string;
    priceAmount: string | null;
  };
}

export class VetServiceListingRequestRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${T} as lr`)
      .join('users as u', 'u.id', 'lr.pet_owner_user_id')
      .join('vet_service_listings as l', 'l.id', 'lr.listing_id')
      .select(
        'lr.*',
        'u.first_name as owner_first_name',
        'u.last_name as owner_last_name',
        'l.title as lst_title',
        'l.service_type as lst_service_type',
        'l.animal_type as lst_animal_type',
        'l.veterinarian_user_id as lst_vet_user_id',
        'l.price_amount as lst_price_amount',
      );
  }

  private map(row: JoinedRow): VetServiceListingRequestJoined {
    return {
      listingRequest: rowToListingRequest(row),
      petOwner: {
        id: row.pet_owner_user_id,
        firstName: row.owner_first_name,
        lastName: row.owner_last_name,
      },
      listing: {
        id: row.listing_id,
        title: row.lst_title,
        serviceType: row.lst_service_type as VetServiceType,
        animalType: row.lst_animal_type as VetServiceAnimalType,
        veterinarianUserId: row.lst_vet_user_id,
        priceAmount: row.lst_price_amount,
      },
    };
  }

  async create(
    data: CreateVetServiceListingRequestInput & {
      listingId: string;
      petOwnerUserId: string;
      requestNumber: string;
    },
    trx: Knex.Transaction,
  ): Promise<VetServiceListingRequest> {
    const [row] = (await trx(T)
      .insert({
        request_number: data.requestNumber,
        listing_id: data.listingId,
        pet_owner_user_id: data.petOwnerUserId,
        animal_type: data.animalType,
        animal_count: data.animalCount ?? null,
        animal_age: data.animalAge ?? null,
        governorate: data.governorate ?? null,
        district: data.district ?? null,
        needs_field_visit: data.needsFieldVisit ?? false,
        preferred_datetime: data.preferredDatetime ?? null,
        budget_amount: data.budgetAmount ?? null,
        notes: data.notes ?? null,
        previous_visit: data.previousVisit ?? null,
        image_keys: data.imageKeys ?? [],
        status: 'PENDING',
      })
      .returning('*')) as VetServiceListingRequestRow[];
    if (!row) throw new Error('vet_service_listing_request insert returned no row');
    return rowToListingRequest(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VetServiceListingRequest | null> {
    const row = await this.conn(trx)<VetServiceListingRequestRow>(T).where({ id }).first();
    return row ? rowToListingRequest(row) : null;
  }

  async findJoinedById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<VetServiceListingRequestJoined | null> {
    const row = (await this.joined(trx).where('lr.id', id).first()) as JoinedRow | undefined;
    return row ? this.map(row) : null;
  }

  async update(
    id: string,
    patch: Partial<{ status: string; conversationId: string | null; decidedAt: Date | null }>,
    trx: Knex.Transaction,
  ): Promise<VetServiceListingRequest> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.conversationId !== undefined) dbPatch.conversation_id = patch.conversationId;
    if (patch.decidedAt !== undefined) dbPatch.decided_at = patch.decidedAt;
    const [row] = (await trx(T)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as VetServiceListingRequestRow[];
    if (!row) throw new Error('vet_service_listing_request not found on update');
    return rowToListingRequest(row);
  }

  /** Requests on ONE listing — the listing vet's "الموافقة على الخدمة" queue. */
  async listForListing(
    listingId: string,
    filter: EngagementListFilter,
  ): Promise<{ items: VetServiceListingRequestJoined[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('lr.listing_id', listingId);
      if (filter.status) qb.andWhere('lr.status', filter.status);
    }, filter);
  }

  /** Requests across ALL of a vet's listings. */
  async listForVet(
    veterinarianUserId: string,
    filter: EngagementListFilter,
  ): Promise<{ items: VetServiceListingRequestJoined[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('l.veterinarian_user_id', veterinarianUserId);
      if (filter.status) qb.andWhere('lr.status', filter.status);
    }, filter);
  }

  /** The caller's own listing-requests. */
  async listMine(
    petOwnerUserId: string,
    filter: EngagementListFilter,
  ): Promise<{ items: VetServiceListingRequestJoined[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('lr.pet_owner_user_id', petOwnerUserId);
      if (filter.status) qb.andWhere('lr.status', filter.status);
    }, filter);
  }

  private async listScoped(
    scope: (qb: Knex.QueryBuilder) => void,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: VetServiceListingRequestJoined[]; total: number }> {
    const countRow = await this.conn()(`${T} as lr`)
      .join('vet_service_listings as l', 'l.id', 'lr.listing_id')
      .modify((qb) => scope(qb))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await this.joined()
      .modify((qb) => scope(qb))
      .orderBy('lr.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }
}
