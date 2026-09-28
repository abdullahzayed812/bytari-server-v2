import type { Knex } from 'knex';
import {
  DAYS_PER_WEEK,
  type DailyRecordSlot,
  type DailyRecordWeekSummary,
} from '../domain/daily-record.js';

export { DAYS_PER_WEEK } from '../domain/daily-record.js';

/** Where a farm type keeps its batches and their daily records. */
export interface DailyRecordTables {
  /** e.g. `poultry_flocks` / `sheep_batches` / `cattle_batches`. */
  batchTable: string;
  /** e.g. `poultry_daily_records`. */
  recordTable: string;
  /** FK column on `recordTable` → `batchTable.id`. */
  batchFk: string;
  /** `average_weight_grams` (poultry) / `average_weight_kg` (sheep, cattle). */
  weightColumn: string;
}

/**
 * Lock the batch row (`SELECT … FOR UPDATE`) and compute the next free weekly
 * slot: one past the latest stored (week, day) — Day 7 rolls over into Day 1
 * of the next week. Two concurrent "add daily record" requests for the same
 * batch serialise on this lock, so they can never take the same slot (the
 * unique (batch, week, day) index is the final guard). A deleted record's
 * slot stays empty — history is never renumbered.
 */
export async function lockBatchAndNextSlot(
  trx: Knex.Transaction,
  t: DailyRecordTables,
  batchId: string,
): Promise<DailyRecordSlot> {
  await trx(t.batchTable).where({ id: batchId }).forUpdate().select('id').first();
  return nextSlot(trx, t, batchId);
}

async function nextSlot(
  conn: Knex | Knex.Transaction,
  t: DailyRecordTables,
  batchId: string,
): Promise<DailyRecordSlot> {
  const row = (await conn(t.recordTable)
    .where(t.batchFk, batchId)
    .select(
      conn.raw(`coalesce(max((week_number - 1) * ${DAYS_PER_WEEK} + day_in_week), 0)::int as seq`),
    )
    .first()) as { seq: number } | undefined;
  const seq = Number(row?.seq ?? 0);
  return {
    weekNumber: Math.floor(seq / DAYS_PER_WEEK) + 1,
    dayInWeek: (seq % DAYS_PER_WEEK) + 1,
  };
}

/**
 * Base select for a batch's daily records: every column (including the stored
 * `week_number` / `day_in_week`) plus the creator's name (`cb_first_name` /
 * `cb_last_name`, joined from `users`), aliased as `r`.
 */
export function selectRecordsWithDayAndCreator(
  conn: Knex | Knex.Transaction,
  t: DailyRecordTables,
  batchId: string,
): Knex.QueryBuilder {
  return conn(`${t.recordTable} as r`)
    .where(`r.${t.batchFk}`, batchId)
    .leftJoin('users as cb', 'cb.id', 'r.created_by_user_id')
    .select('r.*', 'cb.first_name as cb_first_name', 'cb.last_name as cb_last_name');
}

interface WeekAggregateRow {
  week_number: number | string;
  days_recorded: number | string;
  first_date: string | Date | null;
  last_date: string | Date | null;
  total_mortality: number | string;
  total_feed_kg: number | string;
  total_water_liters: number | string;
  total_expenses: number | string;
  latest_weight: number | string | null;
}

/** Week history of a batch (newest week first) + where the next record goes. */
export async function listWeekSummaries(
  conn: Knex | Knex.Transaction,
  t: DailyRecordTables,
  batchId: string,
): Promise<{ weeks: DailyRecordWeekSummary[]; next: DailyRecordSlot }> {
  const rows = await conn(t.recordTable)
    .where(t.batchFk, batchId)
    .groupBy('week_number')
    .orderBy('week_number', 'desc')
    .select<WeekAggregateRow[]>(
      'week_number',
      conn.raw('count(*)::int as days_recorded'),
      conn.raw('min(record_date) as first_date'),
      conn.raw('max(record_date) as last_date'),
      conn.raw('coalesce(sum(mortality_count), 0)::int as total_mortality'),
      conn.raw('coalesce(sum(feed_kg), 0) as total_feed_kg'),
      conn.raw('coalesce(sum(water_liters), 0) as total_water_liters'),
      conn.raw('coalesce(sum(expense_amount), 0) as total_expenses'),
      conn.raw(
        `(array_agg(${t.weightColumn} order by day_in_week desc) filter (where ${t.weightColumn} is not null))[1] as latest_weight`,
      ),
    );
  const dateOnly = (v: string | Date | null): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const weeks = rows.map((r) => ({
    weekNumber: Number(r.week_number),
    daysRecorded: Number(r.days_recorded),
    complete: Number(r.days_recorded) >= DAYS_PER_WEEK,
    firstDate: dateOnly(r.first_date),
    lastDate: dateOnly(r.last_date),
    totalMortality: Number(r.total_mortality),
    totalFeedKg: Number(r.total_feed_kg),
    totalWaterLiters: Number(r.total_water_liters),
    totalExpenses: Number(r.total_expenses),
    latestAverageWeight: r.latest_weight == null ? null : String(r.latest_weight),
  }));
  return { weeks, next: await nextSlot(conn, t, batchId) };
}
