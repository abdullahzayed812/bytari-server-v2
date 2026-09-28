/**
 * Daily records run in continuous WEEKLY cycles per batch: Week 1 Day 1 …
 * Day 7, then Week 2 Day 1 … Day 7, and so on for the batch's lifetime. Each
 * record stores its slot (`week_number`, `day_in_week`), assigned server-side
 * under the batch row lock (`lockBatchAndNextSlot`) so concurrent submissions
 * can never take the same slot. Shared by the poultry, sheep and cattle
 * daily-record services.
 */
export const DAYS_PER_WEEK = 7;

/** Row extras produced by `selectRecordsWithDayAndCreator`. */
export interface DailyRecordRowExtras {
  week_number?: string | number | null;
  day_in_week?: string | number | null;
  cb_first_name?: string | null;
  cb_last_name?: string | null;
}

/** DTO extras: weekly slot + who added the record (name only — no contact data). */
export interface DailyRecordExtras {
  /** Batch-relative week, 1-based. */
  weekNumber: number | null;
  /** Day within {@link weekNumber}, 1 … 7. */
  dayNumber: number | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
}

export function toDailyRecordExtras(
  row: DailyRecordRowExtras & { created_by_user_id: string | null },
): DailyRecordExtras {
  return {
    weekNumber: row.week_number == null ? null : Number(row.week_number),
    dayNumber: row.day_in_week == null ? null : Number(row.day_in_week),
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

/** The next free weekly slot of a batch. */
export interface DailyRecordSlot {
  weekNumber: number;
  dayInWeek: number;
}

/** One batch-relative week for the "completed weeks" history under the batch card. */
export interface DailyRecordWeekSummary {
  weekNumber: number;
  daysRecorded: number;
  /** All seven days of this week are recorded. */
  complete: boolean;
  firstDate: string | null;
  lastDate: string | null;
  totalMortality: number;
  totalFeedKg: number;
  totalWaterLiters: number;
  totalExpenses: number;
  /** Latest recorded average weight in the week (grams for poultry, kg for sheep/cattle). */
  latestAverageWeight: string | null;
}

export interface DailyRecordWeeksDTO {
  /** The week the next daily record will go into. */
  currentWeek: number;
  /** The day (1 … 7) the next daily record will take in {@link currentWeek}. */
  nextDay: number;
  /** Every week that has at least one record, newest first. */
  weeks: DailyRecordWeekSummary[];
}
