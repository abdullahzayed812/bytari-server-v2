import type { Knex } from 'knex';
import {
  rowToOffer,
  type CreateVetServiceOfferInput,
  type EngagementListFilter,
  type VetServiceOffer,
  type VetServiceOfferRow,
  type VetServiceUserSummary,
} from '../domain/vet-service.types.js';
import type {
  VetServiceAnimalType,
  VetServiceType,
} from '../domain/vet-service.constants.js';

const T = 'vet_service_offers';

interface JoinedRow extends VetServiceOfferRow {
  vet_first_name: string;
  vet_last_name: string;
  req_number: string;
  req_title: string;
  req_animal_type: string;
  req_service_type: string;
  req_pet_owner_user_id: string;
}

export interface VetServiceOfferJoined {
  offer: VetServiceOffer;
  veterinarian: VetServiceUserSummary;
  request: {
    id: string;
    requestNumber: string;
    title: string;
    animalType: VetServiceAnimalType;
    serviceType: VetServiceType;
    petOwnerUserId: string;
  };
}

export class VetServiceOfferRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${T} as o`)
      .join('users as u', 'u.id', 'o.veterinarian_user_id')
      .join('vet_service_requests as r', 'r.id', 'o.request_id')
      .select(
        'o.*',
        'u.first_name as vet_first_name',
        'u.last_name as vet_last_name',
        'r.request_number as req_number',
        'r.title as req_title',
        'r.animal_type as req_animal_type',
        'r.service_type as req_service_type',
        'r.pet_owner_user_id as req_pet_owner_user_id',
      );
  }

  private map(row: JoinedRow): VetServiceOfferJoined {
    return {
      offer: rowToOffer(row),
      veterinarian: {
        id: row.veterinarian_user_id,
        firstName: row.vet_first_name,
        lastName: row.vet_last_name,
      },
      request: {
        id: row.request_id,
        requestNumber: row.req_number,
        title: row.req_title,
        animalType: row.req_animal_type as VetServiceAnimalType,
        serviceType: row.req_service_type as VetServiceType,
        petOwnerUserId: row.req_pet_owner_user_id,
      },
    };
  }

  async create(
    data: CreateVetServiceOfferInput & { requestId: string; veterinarianUserId: string },
    trx: Knex.Transaction,
  ): Promise<VetServiceOffer> {
    const [row] = (await trx(T)
      .insert({
        request_id: data.requestId,
        veterinarian_user_id: data.veterinarianUserId,
        proposed_amount: data.proposedAmount ?? null,
        execution_date: data.executionDate ?? null,
        expected_duration: data.expectedDuration ?? null,
        includes_field_visit: data.includesFieldVisit ?? null,
        details: data.details ?? null,
        image_keys: data.imageKeys ?? [],
        status: 'PENDING',
      })
      .returning('*')) as VetServiceOfferRow[];
    if (!row) throw new Error('vet_service_offer insert returned no row');
    return rowToOffer(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VetServiceOffer | null> {
    const row = await this.conn(trx)<VetServiceOfferRow>(T).where({ id }).first();
    return row ? rowToOffer(row) : null;
  }

  async findJoinedById(id: string, trx?: Knex.Transaction): Promise<VetServiceOfferJoined | null> {
    const row = (await this.joined(trx).where('o.id', id).first()) as JoinedRow | undefined;
    return row ? this.map(row) : null;
  }

  async update(
    id: string,
    patch: Partial<{ status: string; conversationId: string | null; decidedAt: Date | null }>,
    trx: Knex.Transaction,
  ): Promise<VetServiceOffer> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.conversationId !== undefined) dbPatch.conversation_id = patch.conversationId;
    if (patch.decidedAt !== undefined) dbPatch.decided_at = patch.decidedAt;
    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as VetServiceOfferRow[];
    if (!row) throw new Error('vet_service_offer not found on update');
    return rowToOffer(row);
  }

  /** Reject every other PENDING offer on a request once one is accepted. */
  async rejectOthers(
    requestId: string,
    keepOfferId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(T)
      .where({ request_id: requestId, status: 'PENDING' })
      .whereNot({ id: keepOfferId })
      .update({ status: 'REJECTED', decided_at: new Date(), updated_at: new Date() });
  }

  /** Offers on a request — the request owner's view. */
  async listForRequest(
    requestId: string,
    filter: EngagementListFilter,
  ): Promise<{ items: VetServiceOfferJoined[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('o.request_id', requestId);
      if (filter.status) qb.andWhere('o.status', filter.status);
    }, filter);
  }

  /** The caller's own submitted offers. */
  async listMine(
    veterinarianUserId: string,
    filter: EngagementListFilter,
  ): Promise<{ items: VetServiceOfferJoined[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('o.veterinarian_user_id', veterinarianUserId);
      if (filter.status) qb.andWhere('o.status', filter.status);
    }, filter);
  }

  private async listScoped(
    scope: (qb: Knex.QueryBuilder) => void,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: VetServiceOfferJoined[]; total: number }> {
    const countRow = await this.conn()(`${T} as o`)
      .modify((qb) => scope(qb))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await this.joined()
      .modify((qb) => scope(qb))
      .orderBy('o.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }
}
