import { describe, expect, it } from 'vitest';
import { computeTrend } from '../../src/modules/poultryMarket/domain/exchange-rate.constants.js';

describe('computeTrend', () => {
  it('returns UP when the current value is higher than the previous one', () => {
    expect(computeTrend('950.00', '900.00')).toBe('UP');
  });

  it('returns DOWN when the current value is lower than the previous one', () => {
    expect(computeTrend('650.00', '900.00')).toBe('DOWN');
  });

  it('returns FLAT when the current value equals the previous one', () => {
    expect(computeTrend('900.00', '900.00')).toBe('FLAT');
  });

  it('returns null when there is no current value', () => {
    expect(computeTrend(null, '900.00')).toBeNull();
  });

  it('returns null when there is no previous value to compare against', () => {
    expect(computeTrend('900.00', null)).toBeNull();
    expect(computeTrend('900.00', undefined)).toBeNull();
  });
});
