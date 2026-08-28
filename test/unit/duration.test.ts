import { describe, expect, it } from 'vitest';
import { durationToSeconds, secondsFromNow } from '../../src/shared/time/duration.js';

describe('durationToSeconds', () => {
  it('parses unit suffixes', () => {
    expect(durationToSeconds('45s')).toBe(45);
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('1h')).toBe(3600);
    expect(durationToSeconds('30d')).toBe(2_592_000);
    expect(durationToSeconds('2w')).toBe(1_209_600);
  });

  it('accepts a bare integer as seconds', () => {
    expect(durationToSeconds('3600')).toBe(3600);
  });

  it('throws on garbage', () => {
    expect(() => durationToSeconds('soon')).toThrow();
    expect(() => durationToSeconds('10x')).toThrow();
  });
});

describe('secondsFromNow', () => {
  it('returns a future date', () => {
    const d = secondsFromNow(60);
    expect(d.getTime()).toBeGreaterThan(Date.now());
    expect(d.getTime()).toBeLessThanOrEqual(Date.now() + 61_000);
  });
});
