import { describe, expect, it } from 'vitest';
import { VeterinaryStoreProductPolicy } from '../../src/modules/veterinary-store/domain/veterinary-store-product.policy.js';
import { VeterinaryOfficeProductPolicy } from '../../src/modules/veterinary-office/domain/veterinary-office-product.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('VeterinaryStoreProductPolicy.assertVeterinaryStore', () => {
  it('accepts only VETERINARY_STORE', () => {
    expect(() =>
      VeterinaryStoreProductPolicy.assertVeterinaryStore({ type: 'VETERINARY_STORE' }),
    ).not.toThrow();
  });
  it('rejects every other organization type, including VETERINARY_OFFICE, with 400 ORGANIZATION_TYPE_NOT_SUPPORTED', () => {
    for (const type of ['CLINIC', 'FARM', 'VETERINARY_OFFICE']) {
      try {
        VeterinaryStoreProductPolicy.assertVeterinaryStore({ type });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
      }
    }
  });
});

describe('VeterinaryOfficeProductPolicy.assertVeterinaryOffice', () => {
  it('accepts only VETERINARY_OFFICE', () => {
    expect(() =>
      VeterinaryOfficeProductPolicy.assertVeterinaryOffice({ type: 'VETERINARY_OFFICE' }),
    ).not.toThrow();
  });
  it('rejects every other organization type, including VETERINARY_STORE, with 400 ORGANIZATION_TYPE_NOT_SUPPORTED', () => {
    for (const type of ['CLINIC', 'FARM', 'VETERINARY_STORE']) {
      try {
        VeterinaryOfficeProductPolicy.assertVeterinaryOffice({ type });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
      }
    }
  });
});

describe('VeterinaryStoreProductPolicy.applyStockDelta', () => {
  it('applies a positive and a negative delta', () => {
    expect(VeterinaryStoreProductPolicy.applyStockDelta(10, 5)).toBe(15);
    expect(VeterinaryStoreProductPolicy.applyStockDelta(10, -4)).toBe(6);
    expect(VeterinaryStoreProductPolicy.applyStockDelta(3, -3)).toBe(0);
  });
  it('rejects an adjustment that would go below zero with 409 INSUFFICIENT_STOCK', () => {
    try {
      VeterinaryStoreProductPolicy.applyStockDelta(3, -4);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('INSUFFICIENT_STOCK');
    }
  });
});

describe('VeterinaryOfficeProductPolicy.applyStockDelta', () => {
  it('applies a positive and a negative delta', () => {
    expect(VeterinaryOfficeProductPolicy.applyStockDelta(10, 5)).toBe(15);
    expect(VeterinaryOfficeProductPolicy.applyStockDelta(3, -3)).toBe(0);
  });
  it('rejects an adjustment that would go below zero with 409 INSUFFICIENT_STOCK', () => {
    try {
      VeterinaryOfficeProductPolicy.applyStockDelta(3, -4);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('INSUFFICIENT_STOCK');
    }
  });
});
