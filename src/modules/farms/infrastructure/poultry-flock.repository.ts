import type { Knex } from 'knex';
import {
  rowToPoultryFlock,
  type ListPoultryFlocksFilter,
  type PoultryFlock,
  type PoultryFlockRow,
} from '../domain/poultry-flock.types.js';

const TABLE = 'poultry_flocks';

export interface CreatePoultryFlockData {
  organizationId: string;
  name: string;
  birdType: string;
  birdCount: number;
  arrivalDate: string;
  notes: string | null;
  createdByUserId: string;
  batchNumber: number;
  initialBirdCount: number;
  averageWeightGrams?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export interface UpdatePoultryFlockData {
  name?: string;
  birdType?: string;
  birdCount?: number;
  arrivalDate?: string;
  status?: string;
  notes?: string | null;
  initialBirdCount?: number | null;
  averageWeightGrams?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export class PoultryFlockRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<PoultryFlock | null> {
    const row = await this.conn(trx)<PoultryFlockRow>(TABLE).where({ id }).first();
    return row ? rowToPoultryFlock(row) : null;
  }

  /** Look up a flock and assert it belongs to this farm (IDOR guard). */
  async findByIdForOrganization(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<PoultryFlock | null> {
    const row = await this.conn(trx)<PoultryFlockRow>(TABLE)
      .where({ id, organization_id: organizationId })
      .first();
    return row ? rowToPoultryFlock(row) : null;
  }

  /** Next per-farm batch number (1-based). Call inside the create transaction. */
  async nextBatchNumber(organizationId: string, trx: Knex.Transaction): Promise<number> {
    const row = (await trx(TABLE)
      .where({ organization_id: organizationId })
      .max<{ max: number | string | null }>({ max: 'batch_number' })
      .first()) as { max: number | string | null } | undefined;
    return Number(row?.max ?? 0) + 1;
  }

  async create(data: CreatePoultryFlockData, trx: Knex.Transaction): Promise<PoultryFlock> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: data.organizationId,
        organization_type: 'FARM',
        name: data.name,
        bird_type: data.birdType,
        bird_count: data.birdCount,
        arrival_date: data.arrivalDate,
        notes: data.notes,
        created_by_user_id: data.createdByUserId,
        batch_number: data.batchNumber,
        initial_bird_count: data.initialBirdCount,
        average_weight_grams: data.averageWeightGrams ?? null,
        target_price_per_kg: data.targetPricePerKg ?? null,
        expected_sale_date: data.expectedSaleDate ?? null,
      })
      .returning('*')) as PoultryFlockRow[];
    if (!row) throw new Error('poultry flock insert did not return a row');
    return rowToPoultryFlock(row);
  }

  async update(
    id: string,
    patch: UpdatePoultryFlockData,
    trx: Knex.Transaction,
  ): Promise<PoultryFlock> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.birdType !== undefined) dbPatch.bird_type = patch.birdType;
    if (patch.birdCount !== undefined) dbPatch.bird_count = patch.birdCount;
    if (patch.arrivalDate !== undefined) dbPatch.arrival_date = patch.arrivalDate;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;
    if (patch.initialBirdCount !== undefined) dbPatch.initial_bird_count = patch.initialBirdCount;
    if (patch.averageWeightGrams !== undefined) {
      dbPatch.average_weight_grams = patch.averageWeightGrams;
    }
    if (patch.targetPricePerKg !== undefined) dbPatch.target_price_per_kg = patch.targetPricePerKg;
    if (patch.expectedSaleDate !== undefined) dbPatch.expected_sale_date = patch.expectedSaleDate;
    if (patch.status !== undefined) {
      dbPatch.status = patch.status;
      dbPatch.closed_at = patch.status === 'CLOSED' ? new Date() : null;
    }

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as PoultryFlockRow[];
    if (!row) throw new Error('poultry flock not found after update');
    return rowToPoultryFlock(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForOrganization(
    organizationId: string,
    filter: ListPoultryFlocksFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: PoultryFlock[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<PoultryFlockRow>(TABLE).where('organization_id', organizationId);
      if (filter.status) qb.andWhere('status', filter.status);
      if (filter.birdType) qb.andWhere('bird_type', filter.birdType);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: PoultryFlockRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToPoultryFlock), total };
  }
}
