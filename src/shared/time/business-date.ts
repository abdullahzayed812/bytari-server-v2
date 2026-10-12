/**
 * The platform's business calendar. Server-assigned "today" dates (e.g. a
 * farm's daily record) use the target market's local day, not UTC — a record
 * added at 01:30 in Baghdad belongs to that Baghdad day.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Baghdad';
/** UTC offset of {@link BUSINESS_TIME_ZONE} — fixed: Iraq has had no DST since 2008. */
export const BUSINESS_UTC_OFFSET = '+03:00';

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
