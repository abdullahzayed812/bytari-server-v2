import { describe, expect, it } from 'vitest';
import {
  dateBoundSchema,
  dateOnlySchema,
  dateTimeSchema,
  normalizeDateOnly,
  normalizeDateTime,
} from '../../src/shared/validation/date-only.js';

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

describe('normalizeDateTime / dateTimeSchema', () => {
  it('accepts unpadded month / day / hour and outputs the canonical padded instant', () => {
    expect(normalizeDateTime('2026-4-7T9:05Z')).toBe('2026-04-07T09:05:00Z');
    expect(normalizeDateTime('2026-04-07T09:05:30.123+03:00')).toBe(
      '2026-04-07T09:05:30.123+03:00',
    );
    expect(normalizeDateTime('2026-9-8T14:05:00+0300')).toBe('2026-09-08T14:05:00+03:00');
    expect(dateTimeSchema().parse('2026-9-8T14:05:00.000Z')).toBe('2026-09-08T14:05:00.000Z');
  });

  it('rejects impossible dates / times and a missing offset', () => {
    for (const bad of [
      '2026-2-30T10:00Z',
      '2026-4-7T24:00Z',
      '2026-4-7T10:60Z',
      '2026-4-7T10:00',
      '2026-4-7',
      'not a date',
    ]) {
      expect(normalizeDateTime(bad)).toBeNull();
      expect(dateTimeSchema().safeParse(bad).success).toBe(false);
    }
  });

  it('padded and unpadded inputs are the same instant', () => {
    expect(new Date(dateTimeSchema().parse('2026-4-7T9:05Z')).toISOString()).toBe(
      new Date('2026-04-07T09:05:00Z').toISOString(),
    );
  });
});

describe('dateBoundSchema', () => {
  it('a bare date (padded or not) is the whole business day in Baghdad', () => {
    const from = dateBoundSchema('start').parse('2026-4-7');
    const to = dateBoundSchema('end').parse('2026-04-07');
    expect(from.toISOString()).toBe('2026-04-06T21:00:00.000Z');
    expect(to.toISOString()).toBe('2026-04-07T20:59:59.999Z');
  });

  it('a full date-time is used as given; garbage is rejected', () => {
    expect(dateBoundSchema('start').parse('2026-4-7T10:00Z').toISOString()).toBe(
      '2026-04-07T10:00:00.000Z',
    );
    expect(dateBoundSchema('end').safeParse('2026-13-1').success).toBe(false);
    expect(dateBoundSchema('end').safeParse('yesterday').success).toBe(false);
  });
});
