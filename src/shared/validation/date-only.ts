import { z } from 'zod';

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
  message = 'Expected a valid date (YYYY-MM-DD)',
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
