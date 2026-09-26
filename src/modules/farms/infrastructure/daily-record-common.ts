import type { Knex } from 'knex';

export { DAILY_RECORDS_PER_BATCH } from '../domain/daily-record.js';

/** Where a farm type keeps its batches and their daily records. */
export interface DailyRecordTables {
  /** e.g. `poultry_flocks` / `sheep_batches` / `cattle_batches`. */
  batchTable: string;
  /** e.g. `poultry_daily_records`. */
  recordTable: string;
  /** FK column on `recordTable` → `batchTable.id`. */
  batchFk: string;
}

/**
 * Lock the batch row (`SELECT … FOR UPDATE`) and count its daily records.
 * Two concurrent "add daily record" requests for the same batch serialise on
 * this lock, so the second one always sees the first one's row — an eighth
 * day can never slip in.
 */
export async function lockBatchAndCountRecords(
  trx: Knex.Transaction,
  t: DailyRecordTables,
  batchId: string,
): Promise<number> {
  await trx(t.batchTable).where({ id: batchId }).forUpdate().select('id').first();
  const row = (await trx(t.recordTable).where(t.batchFk, batchId).count({ count: '*' }).first()) as
    { count: string } | undefined;
  return Number(row?.count ?? 0);
}

/**
 * Base select for a batch's daily records: every column, the record's
 * position in the batch's sequence (`day_number`, oldest = 1 — computed over
 * ALL of the batch's records before any date filter) and the creator's name
 * (`cb_first_name` / `cb_last_name`, joined from `users`).
 */
export function selectRecordsWithDayAndCreator(
  conn: Knex | Knex.Transaction,
  t: DailyRecordTables,
  batchId: string,
): Knex.QueryBuilder {
  const numbered = conn(t.recordTable)
    .where(t.batchFk, batchId)
    .select(
      `${t.recordTable}.*`,
      conn.raw('row_number() over (order by record_date asc, created_at asc) as day_number'),
    )
    .as('r');
  return conn
    .from(numbered)
    .leftJoin('users as cb', 'cb.id', 'r.created_by_user_id')
    .select('r.*', 'cb.first_name as cb_first_name', 'cb.last_name as cb_last_name');
}
