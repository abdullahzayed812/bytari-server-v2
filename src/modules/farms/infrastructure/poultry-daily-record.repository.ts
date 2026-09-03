import type { Knex } from 'knex';
import {
  rowToDailyRecord,
  type CreateDailyRecordInput,
  type ListDailyRecordsFilter,
  type PoultryDailyRecord,
  type PoultryDailyRecordRow,
  type UpdateDailyRecordInput,
} from '../domain/poultry-ops.types.js';

const TABLE = 'poultry_daily_records';

export interface DailyRecordAggregates {
  recordsCount: number;
  totalMortality: number;
  totalFeedKg: number;
  totalWaterLiters: number;
  totalExpenses: number;
}

export class PoultryDailyRecordRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findByIdForFlock(
    id: string,
    flockId: string,
    trx?: Knex.Transaction,
  ): Promise<PoultryDailyRecord | null> {
    const row = await this.conn(trx)<PoultryDailyRecordRow>(TABLE)
      .where({ id, poultry_flock_id: flockId })
      .first();
    return row ? rowToDailyRecord(row) : null;
  }

  async findByFlockAndDate(
    flockId: string,
    recordDate: string,
    trx?: Knex.Transaction,
  ): Promise<PoultryDailyRecord | null> {
    const row = await this.conn(trx)<PoultryDailyRecordRow>(TABLE)
      .where({ poultry_flock_id: flockId, record_date: recordDate })
      .first();
    return row ? rowToDailyRecord(row) : null;
  }

  async create(
    data: CreateDailyRecordInput & {
      poultryFlockId: string;
      organizationId: string;
      createdByUserId: string;
    },
    trx: Knex.Transaction,
  ): Promise<PoultryDailyRecord> {
    const [row] = (await trx(TABLE)
      .insert({
        poultry_flock_id: data.poultryFlockId,
        organization_id: data.organizationId,
        organization_type: 'FARM',
        record_date: data.recordDate,
        feed_kg: data.feedKg ?? 0,
        water_liters: data.waterLiters ?? 0,
        appetite: data.appetite ?? null,
        activity: data.activity ?? null,
        mortality_count: data.mortalityCount ?? 0,
        mortality_cause: data.mortalityCause ?? null,
        treatment: data.treatment ?? null,
        expense_amount: data.expenseAmount ?? 0,
        average_weight_grams: data.averageWeightGrams ?? null,
        notes: data.notes ?? null,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as PoultryDailyRecordRow[];
    if (!row) throw new Error('daily record insert did not return a row');
    return rowToDailyRecord(row);
  }

  async update(
    id: string,
    patch: UpdateDailyRecordInput,
    trx: Knex.Transaction,
  ): Promise<PoultryDailyRecord> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.feedKg !== undefined) dbPatch.feed_kg = patch.feedKg;
    if (patch.waterLiters !== undefined) dbPatch.water_liters = patch.waterLiters;
    if (patch.appetite !== undefined) dbPatch.appetite = patch.appetite;
    if (patch.activity !== undefined) dbPatch.activity = patch.activity;
    if (patch.mortalityCount !== undefined) dbPatch.mortality_count = patch.mortalityCount;
    if (patch.mortalityCause !== undefined) dbPatch.mortality_cause = patch.mortalityCause;
    if (patch.treatment !== undefined) dbPatch.treatment = patch.treatment;
    if (patch.expenseAmount !== undefined) dbPatch.expense_amount = patch.expenseAmount;
    if (patch.averageWeightGrams !== undefined) {
      dbPatch.average_weight_grams = patch.averageWeightGrams;
    }
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as PoultryDailyRecordRow[];
    if (!row) throw new Error('daily record not found after update');
    return rowToDailyRecord(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForFlock(
    flockId: string,
    filter: ListDailyRecordsFilter,
  ): Promise<{ items: PoultryDailyRecord[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<PoultryDailyRecordRow>(TABLE).where('poultry_flock_id', flockId);
      if (filter.from) qb.andWhere('record_date', '>=', filter.from);
      if (filter.to) qb.andWhere('record_date', '<=', filter.to);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: PoultryDailyRecordRow[] = await base()
      .orderBy('record_date', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToDailyRecord), total };
  }

  /** Every record in `[from, to]` (inclusive), oldest first — for weekly summary. */
  async listInRange(flockId: string, from: string, to: string): Promise<PoultryDailyRecord[]> {
    const rows: PoultryDailyRecordRow[] = await this.db<PoultryDailyRecordRow>(TABLE)
      .where('poultry_flock_id', flockId)
      .andWhere('record_date', '>=', from)
      .andWhere('record_date', '<=', to)
      .orderBy('record_date', 'asc');
    return rows.map(rowToDailyRecord);
  }

  /** Whole-batch aggregates for the batch-summary card. */
  async aggregateForFlock(flockId: string): Promise<DailyRecordAggregates> {
    const row = (await this.db(TABLE)
      .where('poultry_flock_id', flockId)
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
  async latestWeightForFlock(flockId: string): Promise<string | null> {
    const row = (await this.db<PoultryDailyRecordRow>(TABLE)
      .where('poultry_flock_id', flockId)
      .whereNotNull('average_weight_grams')
      .orderBy('record_date', 'desc')
      .first()) as { average_weight_grams: string | number } | undefined;
    return row ? String(row.average_weight_grams) : null;
  }
}
