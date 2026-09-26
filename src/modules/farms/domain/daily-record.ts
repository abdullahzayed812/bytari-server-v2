/**
 * Daily records are a WEEKLY sequence per batch: Day 1 … Day 7. After the
 * seventh record no more daily records are accepted for that batch (enforced
 * server-side under a row lock — `lockBatchAndCountRecords`). Shared by the
 * poultry, sheep and cattle daily-record services.
 */
export const DAILY_RECORDS_PER_BATCH = 7;

/** Row extras produced by `selectRecordsWithDayAndCreator`. */
export interface DailyRecordRowExtras {
  day_number?: string | number | null;
  cb_first_name?: string | null;
  cb_last_name?: string | null;
}

/** DTO extras: sequence position + who added the record (name only — no contact data). */
export interface DailyRecordExtras {
  dayNumber: number | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
}

export function toDailyRecordExtras(
  row: DailyRecordRowExtras & { created_by_user_id: string | null },
): DailyRecordExtras {
  return {
    dayNumber: row.day_number == null ? null : Number(row.day_number),
    createdBy:
      row.created_by_user_id && row.cb_first_name != null
        ? {
            id: row.created_by_user_id,
            firstName: row.cb_first_name,
            lastName: row.cb_last_name ?? '',
          }
        : null,
  };
}
