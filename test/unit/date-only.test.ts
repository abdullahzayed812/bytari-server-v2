import { describe, expect, it } from 'vitest';
import { dateOnlySchema, normalizeDateOnly } from '../../src/shared/validation/date-only.js';

describe('normalizeDateOnly', () => {
  it.each([
    ['2026-07-04', '2026-07-04'],
    ['2026-4-7', '2026-04-07'],
    ['2026-04-7', '2026-04-07'],
    ['2026-4-07', '2026-04-07'],
    [' 2026-12-31 ', '2026-12-31'],
    ['2024-2-29', '2024-02-29'], // leap day
  ])('accepts %s → %s', (input, expected) => {
    expect(normalizeDateOnly(input)).toBe(expected);
  });

  it.each([
    '2026-13-4',
    '2026-2-30',
    '2026-00-10',
    '2026-4-0',
    '2026-04-31',
    '2025-2-29', // not a leap year
    '2026-004-07',
    '26-4-7',
    '2026/4/7',
    '2026-04-07T00:00:00Z',
    '',
  ])('rejects %s', (input) => {
    expect(normalizeDateOnly(input)).toBeNull();
  });

  it('is independent of the process timezone (no Date-string parsing)', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['Asia/Baghdad', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
        process.env.TZ = tz;
        expect(normalizeDateOnly('2026-4-7')).toBe('2026-04-07');
        expect(normalizeDateOnly('2026-1-1')).toBe('2026-01-01');
      }
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('dateOnlySchema', () => {
  it('outputs the canonical padded form, so string comparisons stay correct', () => {
    const range = dateOnlySchema();
    expect(range.parse('2026-4-7')).toBe('2026-04-07');
    // "2026-4-10" < "2026-4-9" as raw strings — but not once normalized.
    expect(range.parse('2026-4-10') > range.parse('2026-4-9')).toBe(true);
  });

  it('rejects impossible dates instead of rolling them over', () => {
    const r = dateOnlySchema().safeParse('2026-2-30');
    expect(r.success).toBe(false);
  });

  it('keeps chained rules working on the normalized value', () => {
    const notAfter = dateOnlySchema().refine((v) => v <= '2026-04-10', 'future');
    expect(notAfter.safeParse('2026-4-9').success).toBe(true);
    expect(notAfter.safeParse('2026-4-11').success).toBe(false);
    expect(dateOnlySchema().nullable().optional().parse(null)).toBeNull();
  });
});
