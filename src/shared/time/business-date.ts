/**
 * The platform's business calendar. Server-assigned "today" dates (e.g. a
 * farm's daily record) use the target market's local day, not UTC — a record
 * added at 01:30 in Baghdad belongs to that Baghdad day.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Baghdad';
/** UTC offset of {@link BUSINESS_TIME_ZONE} — fixed: Iraq has had no DST since 2008. */
export const BUSINESS_UTC_OFFSET = '+03:00';

/**
 * SQL counterpart of {@link businessToday}: today's date in the business time
 * zone. Use instead of `CURRENT_DATE`, which follows the database session's
 * zone (UTC in production) and lags Baghdad by a day from 00:00 to 03:00.
 */
export const BUSINESS_CURRENT_DATE_SQL = `(now() AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date`;

/** `YYYY-MM-DD` of `now` in {@link BUSINESS_TIME_ZONE}. */
export function businessToday(now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Hour of day (0–23) of `now` in {@link BUSINESS_TIME_ZONE}. */
export function businessHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TIME_ZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
}
