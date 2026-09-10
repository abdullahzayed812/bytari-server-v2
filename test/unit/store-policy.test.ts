import { describe, expect, it } from 'vitest';
import { StorePolicy } from '../../src/modules/veterinary-store/domain/store.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('StorePolicy.assertProductCapable', () => {
  it('accepts a VETERINARY_STORE or a VETERINARY_OFFICE', () => {
    expect(() => StorePolicy.assertProductCapable({ type: 'VETERINARY_STORE' })).not.toThrow();
    expect(() => StorePolicy.assertProductCapable({ type: 'VETERINARY_OFFICE' })).not.toThrow();
  });
  it('rejects every other organization type with 400 ORGANIZATION_TYPE_NOT_SUPPORTED', () => {
    for (const type of ['CLINIC', 'FARM']) {
      try {
        StorePolicy.assertProductCapable({ type });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
      }
    }
  });
});

describe('StorePolicy.applyStockDelta', () => {
  it('applies a positive and a negative delta', () => {
    expect(StorePolicy.applyStockDelta(10, 5)).toBe(15);
    expect(StorePolicy.applyStockDelta(10, -4)).toBe(6);
    expect(StorePolicy.applyStockDelta(3, -3)).toBe(0);
  });
  it('rejects an adjustment that would go below zero with 409 INSUFFICIENT_STOCK', () => {
    try {
      StorePolicy.applyStockDelta(3, -4);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('INSUFFICIENT_STOCK');
    }
  });
});
