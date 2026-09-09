import { describe, expect, it } from 'vitest';
import {
  PetOwnerStorePolicy,
  addMoney,
  fromMinorUnits,
  multiplyMoney,
  toMinorUnits,
} from '../../src/modules/pet-owner-store/domain/pet-owner-store.policy.js';

describe('pet-owner-store money helpers', () => {
  it('parses and renders numeric(12,2) strings without floats', () => {
    expect(toMinorUnits('85.00')).toBe(8500);
    expect(toMinorUnits('12.5')).toBe(1250);
    expect(toMinorUnits('0')).toBe(0);
    expect(fromMinorUnits(8500)).toBe('85.00');
    expect(fromMinorUnits(1)).toBe('0.01');
  });

  it('adds and multiplies money exactly', () => {
    expect(addMoney('85.00', '28.00')).toBe('113.00');
    expect(multiplyMoney('28.00', 3)).toBe('84.00');
    expect(multiplyMoney('0.10', 3)).toBe('0.30'); // no 0.30000000000000004
  });

  it('computes cart totals from priced lines', () => {
    const totals = PetOwnerStorePolicy.computeTotals(
      [
        { unitPrice: '85.00', quantity: 1 },
        { unitPrice: '28.00', quantity: 2 },
      ],
      '0.00',
    );
    expect(totals).toEqual({
      subtotalAmount: '141.00',
      deliveryFee: '0.00',
      totalAmount: '141.00',
    });
  });
});

describe('pet-owner-store order transitions', () => {
  it('allows valid forward moves and cancellation', () => {
    expect(() => PetOwnerStorePolicy.assertOrderTransition('PENDING', 'CONFIRMED')).not.toThrow();
    expect(() => PetOwnerStorePolicy.assertOrderTransition('SHIPPED', 'DELIVERED')).not.toThrow();
    expect(() =>
      PetOwnerStorePolicy.assertOrderTransition('PROCESSING', 'CANCELLED'),
    ).not.toThrow();
  });

  it('refuses skips and moves out of terminal states', () => {
    expect(() => PetOwnerStorePolicy.assertOrderTransition('PENDING', 'DELIVERED')).toThrow();
    expect(() => PetOwnerStorePolicy.assertOrderTransition('DELIVERED', 'SHIPPED')).toThrow();
    expect(() => PetOwnerStorePolicy.assertOrderTransition('CANCELLED', 'PENDING')).toThrow();
    expect(() => PetOwnerStorePolicy.assertOrderTransition('PENDING', 'PENDING')).toThrow();
  });
});

describe('pet-owner-store payment + stock guards', () => {
  it('only Cash on Delivery is enabled right now', () => {
    expect(() => PetOwnerStorePolicy.assertPaymentMethodEnabled('COD')).not.toThrow();
    expect(() => PetOwnerStorePolicy.assertPaymentMethodEnabled('MADA')).toThrow();
    expect(() => PetOwnerStorePolicy.assertPaymentMethodEnabled('CREDIT_CARD')).toThrow();
  });

  it('assertPurchasable enforces ACTIVE + sufficient stock', () => {
    const p = { status: 'ACTIVE', stockQuantity: 5, name: 'x' };
    expect(() => PetOwnerStorePolicy.assertPurchasable(p, 5)).not.toThrow();
    expect(() => PetOwnerStorePolicy.assertPurchasable(p, 6)).toThrow();
    expect(() => PetOwnerStorePolicy.assertPurchasable({ ...p, status: 'INACTIVE' }, 1)).toThrow();
  });

  it('order numbers match POS-<yyyymmdd>-<6 digits>', () => {
    expect(PetOwnerStorePolicy.generateOrderNumber(new Date('2026-09-07T00:00:00Z'))).toMatch(
      /^POS-20260907-\d{6}$/,
    );
  });
});
