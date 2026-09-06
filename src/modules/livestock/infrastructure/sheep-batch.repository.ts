import type { Knex } from 'knex';
import {
  rowToSheepBatch,
  type ListSheepBatchesFilter,
  type SheepBatch,
  type SheepBatchRow,
} from '../domain/sheep-batch.types.js';

const TABLE = 'sheep_batches';

export interface CreateSheepBatchData {
  organizationId: string;
  name: string;
  breed: string | null;
  headCount: number;
  lambCount: number | null;
  maleCount: number | null;
  femaleCount: number | null;
  arrivalDate: string;
  notes: string | null;
  createdByUserId: string;
  batchNumber: number;
  initialHeadCount: number;
  averageWeightKg?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export interface UpdateSheepBatchData {
  name?: string;
  breed?: string | null;
  headCount?: number;
  lambCount?: number | null;
  maleCount?: number | null;
  femaleCount?: number | null;
  arrivalDate?: string;
  status?: string;
  notes?: string | null;
  initialHeadCount?: number | null;
  averageWeightKg?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export class SheepBatchRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<SheepBatch | null> {
    const row = await this.conn(trx)<SheepBatchRow>(TABLE).where({ id }).first();
    return row ? rowToSheepBatch(row) : null;
  }

  /** Look up a batch and assert it belongs to this farm (IDOR guard). */
  async findByIdForOrganization(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<SheepBatch | null> {
    const row = await this.conn(trx)<SheepBatchRow>(TABLE)
      .where({ id, organization_id: organizationId })
      .first();
    return row ? rowToSheepBatch(row) : null;
  }

  /** Next per-farm batch number (1-based). Call inside the create transaction. */
  async nextBatchNumber(organizationId: string, trx: Knex.Transaction): Promise<number> {
    const row = (await trx(TABLE)
      .where({ organization_id: organizationId })
      .max<{ max: number | string | null }>({ max: 'batch_number' })
      .first()) as { max: number | string | null } | undefined;
    return Number(row?.max ?? 0) + 1;
  }

  async create(data: CreateSheepBatchData, trx: Knex.Transaction): Promise<SheepBatch> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: data.organizationId,
        organization_type: 'FARM',
        name: data.name,
        breed: data.breed,
        head_count: data.headCount,
        lamb_count: data.lambCount,
        male_count: data.maleCount,
        female_count: data.femaleCount,
        arrival_date: data.arrivalDate,
        notes: data.notes,
        created_by_user_id: data.createdByUserId,
        batch_number: data.batchNumber,
        initial_head_count: data.initialHeadCount,
        average_weight_kg: data.averageWeightKg ?? null,
        target_price_per_kg: data.targetPricePerKg ?? null,
        expected_sale_date: data.expectedSaleDate ?? null,
      })
      .returning('*')) as SheepBatchRow[];
    if (!row) throw new Error('sheep batch insert did not return a row');
    return rowToSheepBatch(row);
  }

  async update(id: string, patch: UpdateSheepBatchData, trx: Knex.Transaction): Promise<SheepBatch> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.breed !== undefined) dbPatch.breed = patch.breed;
    if (patch.headCount !== undefined) dbPatch.head_count = patch.headCount;
    if (patch.lambCount !== undefined) dbPatch.lamb_count = patch.lambCount;
    if (patch.maleCount !== undefined) dbPatch.male_count = patch.maleCount;
    if (patch.femaleCount !== undefined) dbPatch.female_count = patch.femaleCount;
    if (patch.arrivalDate !== undefined) dbPatch.arrival_date = patch.arrivalDate;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;
    if (patch.initialHeadCount !== undefined) dbPatch.initial_head_count = patch.initialHeadCount;
    if (patch.averageWeightKg !== undefined) dbPatch.average_weight_kg = patch.averageWeightKg;
    if (patch.targetPricePerKg !== undefined) dbPatch.target_price_per_kg = patch.targetPricePerKg;
    if (patch.expectedSaleDate !== undefined) dbPatch.expected_sale_date = patch.expectedSaleDate;
    if (patch.status !== undefined) {
      dbPatch.status = patch.status;
      dbPatch.closed_at = patch.status === 'CLOSED' ? new Date() : null;
    }

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as SheepBatchRow[];
    if (!row) throw new Error('sheep batch not found after update');
    return rowToSheepBatch(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForOrganization(
    organizationId: string,
    filter: ListSheepBatchesFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: SheepBatch[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<SheepBatchRow>(TABLE).where('organization_id', organizationId);
      if (filter.status) qb.andWhere('status', filter.status);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: SheepBatchRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToSheepBatch), total };
  }
}
