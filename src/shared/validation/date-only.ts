import { z } from 'zod';
import { BUSINESS_UTC_OFFSET } from '../time/business-date.js';

/**
 * Calendar-date (no time, no timezone) input handling shared by every request
 * schema. Clients may send the month / day with or without a leading zero
 * (`2026-04-07`, `2026-4-7`, `2026-04-7`, `2026-4-07`); the value is checked
 * against the real calendar (no `2026-02-30`, no month 13 / day 0) and
 * normalized to the canonical `YYYY-MM-DD` the database and every string
 * comparison (`v <= businessToday()`, `endDate >= startDate`) rely on.
 *
 * Never parsed through `Date.parse` / `new Date(string)`: those roll invalid
 * days over (`2026-02-30` → Mar 2) and read an unpadded value as LOCAL time,
 * which can move it across a day boundary.
 */
const DATE_ONLY_INPUT_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month = the last day of `month` (UTC, so no DST/zone effect).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `YYYY-M-D` / `YYYY-MM-DD` → canonical `YYYY-MM-DD`, or `null` if it is not a real calendar date. */
export function normalizeDateOnly(value: string): string | null {
  const m = DATE_ONLY_INPUT_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  if (day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/**
 * A date-only request field: accepts padded or unpadded month/day, rejects
 * impossible dates, outputs canonical `YYYY-MM-DD`. Chain further rules
 * (`.refine(v => v <= businessToday())`) on the normalized output.
 */
export function dateOnlySchema(
  message = 'Expected a valid date (YYYY-M-D or YYYY-MM-DD)',
): z.ZodEffects<z.ZodString, string, string> {
  return z.string().transform((value, ctx) => {
    const normalized = normalizeDateOnly(value);
    if (normalized === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return normalized;
  });
}

/**
 * `YYYY-M-DTH:mm[:ss[.fff]](Z|±HH:MM)` — an ISO-8601 instant whose date part
 * (and hour) may be unpadded. Offset required, as before.
 */
const DATE_TIME_INPUT_RE =
  /^(\d{4}-\d{1,2}-\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Padded / unpadded ISO datetime → canonical `YYYY-MM-DDTHH:mm:ss[.fff](Z|±HH:MM)`,
 * or `null` if the calendar date or the time is impossible.
 */
export function normalizeDateTime(value: string): string | null {
  const m = DATE_TIME_INPUT_RE.exec(value.trim());
  if (!m) return null;
  const date = normalizeDateOnly(m[1]!);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  const second = m[4] === undefined ? 0 : Number(m[4]);
  if (date === null || hour > 23 || minute > 59 || second > 59) return null;
  const rawOffset = m[6]!.toUpperCase();
  const offset =
    rawOffset === 'Z'
      ? 'Z'
      : rawOffset.includes(':')
        ? rawOffset
        : `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4, 6)) > 59)) {
    return null;
  }
  return `${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${m[5] ?? ''}${offset}`;
}

/**
 * A date-time request field (an instant, offset required). Accepts the month /
 * day / hour with or without a leading zero; outputs the canonical padded ISO
 * string, so every consumer (`new Date(v)`, DB timestamptz) behaves exactly as
 * with a padded input.
 */
export function dateTimeSchema(
  message = 'Expected a valid ISO-8601 date-time with offset (e.g. 2026-4-7T14:05:00Z)',
): z.ZodEffects<z.ZodString, string, string> {
  return z.string().transform((value, ctx) => {
    const normalized = normalizeDateTime(value);
    if (normalized === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return normalized;
  });
}

/**
 * A range-filter bound (`from` / `to` query params) as a `Date`: either a
 * full date-time (above) or a calendar date (padded or not). A bare date means
 * the START of that day for `'start'` bounds and the END of it for `'end'`
 * bounds, in the business time zone — so `from=2026-4-7&to=2026-4-7` covers
 * all of 7 April in Baghdad, whichever padding the client used.
 */
export function dateBoundSchema(
  bound: 'start' | 'end',
  message = 'Expected a date (YYYY-M-D) or an ISO-8601 date-time',
): z.ZodEffects<z.ZodString, Date, string> {
  return z.string().transform((value, ctx) => {
    const day = normalizeDateOnly(value);
    const iso =
      day !== null
        ? `${day}T${bound === 'start' ? '00:00:00.000' : '23:59:59.999'}${BUSINESS_UTC_OFFSET}`
        : normalizeDateTime(value);
    const date = iso === null ? null : new Date(iso);
    if (!date || Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return date;
  });
}
