import type { Knex } from 'knex';
import {
  rowToCattleDailyRecord,
  type CreateCattleDailyRecordInput,
  type ListCattleDailyRecordsFilter,
  type CattleDailyRecord,
  type CattleDailyRecordRow,
  type UpdateCattleDailyRecordInput,
} from '../domain/cattle-ops.types.js';

const TABLE = 'cattle_daily_records';

export interface CattleDailyRecordAggregates {
  recordsCount: number;
  totalMortality: number;
  totalFeedKg: number;
  totalWaterLiters: number;
  totalExpenses: number;
}

export class CattleDailyRecordRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findByIdForBatch(
    id: string,
    batchId: string,
    trx?: Knex.Transaction,
  ): Promise<CattleDailyRecord | null> {
    const row = await this.conn(trx)<CattleDailyRecordRow>(TABLE)
      .where({ id, cattle_batch_id: batchId })
      .first();
    return row ? rowToCattleDailyRecord(row) : null;
  }

  async findByBatchAndDate(
    batchId: string,
    recordDate: string,
    trx?: Knex.Transaction,
  ): Promise<CattleDailyRecord | null> {
    const row = await this.conn(trx)<CattleDailyRecordRow>(TABLE)
      .where({ cattle_batch_id: batchId, record_date: recordDate })
      .first();
    return row ? rowToCattleDailyRecord(row) : null;
  }

  async create(
    data: CreateCattleDailyRecordInput & {
      cattleBatchId: string;
      organizationId: string;
      createdByUserId: string;
    },
    trx: Knex.Transaction,
  ): Promise<CattleDailyRecord> {
    const [row] = (await trx(TABLE)
      .insert({
        cattle_batch_id: data.cattleBatchId,
        organization_id: data.organizationId,
        organization_type: 'FARM',
        record_date: data.recordDate,
        feed_kg: data.feedKg ?? 0,
        water_liters: data.waterLiters ?? 0,
        appetite: data.appetite ?? null,
        activity: data.activity ?? null,
        mortality_count: data.mortalityCount ?? 0,
        mortality_cause: data.mortalityCause ?? null,
        sick_cases_count: data.sickCasesCount ?? 0,
        feed_type: data.feedType ?? null,
        treatment: data.treatment ?? null,
        expense_amount: data.expenseAmount ?? 0,
        average_weight_kg: data.averageWeightKg ?? null,
        notes: data.notes ?? null,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as CattleDailyRecordRow[];
    if (!row) throw new Error('daily record insert did not return a row');
    return rowToCattleDailyRecord(row);
  }

  async update(
    id: string,
    patch: UpdateCattleDailyRecordInput,
    trx: Knex.Transaction,
  ): Promise<CattleDailyRecord> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.feedKg !== undefined) dbPatch.feed_kg = patch.feedKg;
    if (patch.waterLiters !== undefined) dbPatch.water_liters = patch.waterLiters;
    if (patch.appetite !== undefined) dbPatch.appetite = patch.appetite;
    if (patch.activity !== undefined) dbPatch.activity = patch.activity;
    if (patch.mortalityCount !== undefined) dbPatch.mortality_count = patch.mortalityCount;
    if (patch.mortalityCause !== undefined) dbPatch.mortality_cause = patch.mortalityCause;
    if (patch.sickCasesCount !== undefined) dbPatch.sick_cases_count = patch.sickCasesCount;
    if (patch.feedType !== undefined) dbPatch.feed_type = patch.feedType;
    if (patch.treatment !== undefined) dbPatch.treatment = patch.treatment;
    if (patch.expenseAmount !== undefined) dbPatch.expense_amount = patch.expenseAmount;
    if (patch.averageWeightKg !== undefined) dbPatch.average_weight_kg = patch.averageWeightKg;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as CattleDailyRecordRow[];
    if (!row) throw new Error('daily record not found after update');
    return rowToCattleDailyRecord(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForBatch(
    batchId: string,
    filter: ListCattleDailyRecordsFilter,
  ): Promise<{ items: CattleDailyRecord[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<CattleDailyRecordRow>(TABLE).where('cattle_batch_id', batchId);
      if (filter.from) qb.andWhere('record_date', '>=', filter.from);
      if (filter.to) qb.andWhere('record_date', '<=', filter.to);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: CattleDailyRecordRow[] = await base()
      .orderBy('record_date', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToCattleDailyRecord), total };
  }

  /** Every record in `[from, to]` (inclusive), oldest first — for weekly summary. */
  async listInRange(batchId: string, from: string, to: string): Promise<CattleDailyRecord[]> {
    const rows: CattleDailyRecordRow[] = await this.db<CattleDailyRecordRow>(TABLE)
      .where('cattle_batch_id', batchId)
      .andWhere('record_date', '>=', from)
      .andWhere('record_date', '<=', to)
      .orderBy('record_date', 'asc');
    return rows.map(rowToCattleDailyRecord);
  }

  /** Whole-batch aggregates for the batch-summary card. */
  async aggregateForBatch(batchId: string): Promise<CattleDailyRecordAggregates> {
    const row = (await this.db(TABLE)
      .where('cattle_batch_id', batchId)
      .select(
        this.db.raw('count(*)::int as records_count'),
        this.db.raw('coalesce(sum(mortality_count), 0)::int as total_mortality'),
        this.db.raw('coalesce(sum(feed_kg), 0) as total_feed_kg'),
        this.db.raw('coalesce(sum(water_liters), 0) as total_water_liters'),
        this.db.raw('coalesce(sum(expense_amount), 0) as total_expenses'),
      )
      .first()) as {
      records_count: number;
      total_mortality: number;
      total_feed_kg: string | number;
      total_water_liters: string | number;
      total_expenses: string | number;
    };
    return {
      recordsCount: Number(row.records_count),
      totalMortality: Number(row.total_mortality),
      totalFeedKg: Number(row.total_feed_kg),
      totalWaterLiters: Number(row.total_water_liters),
      totalExpenses: Number(row.total_expenses),
    };
  }

  /** Most recent record that carries a weight, for the batch-summary fallback. */
  async latestWeightForBatch(batchId: string): Promise<string | null> {
    const row = (await this.db<CattleDailyRecordRow>(TABLE)
      .where('cattle_batch_id', batchId)
      .whereNotNull('average_weight_kg')
      .orderBy('record_date', 'desc')
      .first()) as { average_weight_kg: string | number } | undefined;
    return row ? String(row.average_weight_kg) : null;
  }
}
