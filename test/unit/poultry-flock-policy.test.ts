import { describe, expect, it } from 'vitest';
import { PoultryFlockPolicy } from '../../src/modules/farms/domain/poultry-flock.policy.js';
import type { AppError } from '../../src/shared/errors/app-error.js';

describe('PoultryFlockPolicy.assertFlockMutable', () => {
  it('accepts an ACTIVE flock', () => {
    expect(() => PoultryFlockPolicy.assertFlockMutable({ status: 'ACTIVE' })).not.toThrow();
  });
  it('rejects a CLOSED flock with 409 POULTRY_FLOCK_NOT_ACTIVE', () => {
    try {
      PoultryFlockPolicy.assertFlockMutable({ status: 'CLOSED' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('POULTRY_FLOCK_NOT_ACTIVE');
    }
  });
});
