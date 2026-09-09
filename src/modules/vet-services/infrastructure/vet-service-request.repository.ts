import type { Knex } from 'knex';
import {
  rowToRequest,
  type CreateVetServiceRequestInput,
  type MineFilter,
  type ModerationFilter,
  type RequestBrowseFilter,
  type VetServiceRequest,
  type VetServiceRequestRow,
  type VetServiceUserSummary,
} from '../domain/vet-service.types.js';

const T = 'vet_service_requests';

interface JoinedRow extends VetServiceRequestRow {
  owner_first_name: string;
  owner_last_name: string;
  offer_count?: string;
}

export interface VetServiceRequestWithOwner {
  request: VetServiceRequest;
  petOwner: VetServiceUserSummary;
  offerCount: number;
}

/** `REQ-<year>-<seq padded>` from the shared `vet_service_request_seq`. */
export async function nextRequestNumber(trx: Knex.Transaction): Promise<string> {
  const res: { rows: Array<{ v: string }> } = await trx.raw(
    `SELECT nextval('vet_service_request_seq') AS v`,
  );
  const seq = Number(res.rows[0]?.v ?? 0);
  return `REQ-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
}

export class VetServiceRequestRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${T} as r`)
      .join('users as u', 'u.id', 'r.pet_owner_user_id')
      .select(
        'r.*',
        'u.first_name as owner_first_name',
        'u.last_name as owner_last_name',
        this.conn(trx).raw(
          '(SELECT count(*) FROM vet_service_offers o WHERE o.request_id = r.id) AS offer_count',
        ),
      );
  }

  private map(row: JoinedRow): VetServiceRequestWithOwner {
    return {
      request: rowToRequest(row),
      petOwner: {
        id: row.pet_owner_user_id,
        firstName: row.owner_first_name,
        lastName: row.owner_last_name,
      },
      offerCount: Number(row.offer_count ?? 0),
    };
  }

  async create(
    data: CreateVetServiceRequestInput & { petOwnerUserId: string; requestNumber: string },
    trx: Knex.Transaction,
  ): Promise<VetServiceRequest> {
    const [row] = (await trx(T)
      .insert({
        request_number: data.requestNumber,
        pet_owner_user_id: data.petOwnerUserId,
        title: data.title,
        description: data.description,
        animal_type: data.animalType,
        service_type: data.serviceType,
        animal_count: data.animalCount ?? null,
        animal_age: data.animalAge ?? null,
        governorate: data.governorate,
        district: data.district ?? null,
        detailed_address: data.detailedAddress ?? null,
        needs_field_visit: data.needsFieldVisit ?? false,
        preferred_date: data.preferredDate ?? null,
        budget_amount: data.budgetAmount ?? null,
        urgency: data.urgency ?? 'NORMAL',
        extra_notes: data.extraNotes ?? null,
        image_keys: data.imageKeys ?? [],
        status: 'PENDING',
      })
      .returning('*')) as VetServiceRequestRow[];
    if (!row) throw new Error('vet_service_request insert returned no row');
    return rowToRequest(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VetServiceRequest | null> {
    const row = await this.conn(trx)<VetServiceRequestRow>(T).where({ id }).first();
    return row ? rowToRequest(row) : null;
  }

  async findWithOwnerById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<VetServiceRequestWithOwner | null> {
    const row = (await this.joined(trx).where('r.id', id).first()) as JoinedRow | undefined;
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
  ): Promise<VetServiceRequest> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.reviewedByUserId !== undefined) dbPatch.reviewed_by_user_id = patch.reviewedByUserId;
    if (patch.reviewedAt !== undefined) dbPatch.reviewed_at = patch.reviewedAt;
    if (patch.rejectionReason !== undefined) dbPatch.rejection_reason = patch.rejectionReason;
    if (patch.closedAt !== undefined) dbPatch.closed_at = patch.closedAt;
    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as VetServiceRequestRow[];
    if (!row) throw new Error('vet_service_request not found on update');
    return rowToRequest(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(T).where({ id }).del();
  }

  async listPublic(
    filter: RequestBrowseFilter,
  ): Promise<{ items: VetServiceRequestWithOwner[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('r.status', 'APPROVED').whereNull('r.closed_at');
      if (filter.serviceType) qb.andWhere('r.service_type', filter.serviceType);
      if (filter.animalType) qb.andWhere('r.animal_type', filter.animalType);
      if (filter.governorate) qb.andWhere('r.governorate', filter.governorate);
      if (filter.urgency) qb.andWhere('r.urgency', filter.urgency);
      if (filter.search) {
        const s = `%${filter.search}%`;
        qb.andWhere((w) => {
          w.whereILike('r.title', s).orWhereILike('r.description', s);
        });
      }
    }, filter, filter.sort === 'oldest' ? 'asc' : 'desc');
  }

  async listMine(
    petOwnerUserId: string,
    filter: MineFilter,
  ): Promise<{ items: VetServiceRequestWithOwner[]; total: number }> {
    return this.listScoped((qb) => {
      qb.where('r.pet_owner_user_id', petOwnerUserId);
      if (filter.status) qb.andWhere('r.status', filter.status);
    }, filter);
  }

  async listForModeration(
    filter: ModerationFilter,
  ): Promise<{ items: VetServiceRequestWithOwner[]; total: number }> {
    return this.listScoped((qb) => {
      qb.andWhere('r.status', filter.status ?? 'PENDING');
    }, filter);
  }

  private async listScoped(
    scope: (qb: Knex.QueryBuilder) => void,
    filter: { page: number; pageSize: number },
    order: 'asc' | 'desc' = 'desc',
  ): Promise<{ items: VetServiceRequestWithOwner[]; total: number }> {
    const countRow = await this.conn()(`${T} as r`)
      .modify((qb) => scope(qb))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await this.joined()
      .modify((qb) => scope(qb))
      .orderBy('r.created_at', order)
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];
    return { items: rows.map((r) => this.map(r)), total };
  }
}
