import { describe, expect, it } from 'vitest';
import {
  VeterinarianStorePolicy,
  addMoney,
  fromMinorUnits,
  multiplyMoney,
  toMinorUnits,
} from '../../src/modules/veterinarian-store/domain/veterinarian-store.policy.js';

describe('veterinarian-store money helpers', () => {
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
    const totals = VeterinarianStorePolicy.computeTotals(
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

describe('veterinarian-store order transitions', () => {
  it('allows valid forward moves and cancellation', () => {
    expect(() =>
      VeterinarianStorePolicy.assertOrderTransition('PENDING', 'CONFIRMED'),
    ).not.toThrow();
    expect(() =>
      VeterinarianStorePolicy.assertOrderTransition('SHIPPED', 'DELIVERED'),
    ).not.toThrow();
    expect(() =>
      VeterinarianStorePolicy.assertOrderTransition('PROCESSING', 'CANCELLED'),
    ).not.toThrow();
  });

  it('refuses skips and moves out of terminal states', () => {
    expect(() => VeterinarianStorePolicy.assertOrderTransition('PENDING', 'DELIVERED')).toThrow();
    expect(() => VeterinarianStorePolicy.assertOrderTransition('DELIVERED', 'SHIPPED')).toThrow();
    expect(() => VeterinarianStorePolicy.assertOrderTransition('CANCELLED', 'PENDING')).toThrow();
    expect(() => VeterinarianStorePolicy.assertOrderTransition('PENDING', 'PENDING')).toThrow();
  });
});

describe('veterinarian-store payment + stock guards', () => {
  it('only Cash on Delivery is enabled right now', () => {
    expect(() => VeterinarianStorePolicy.assertPaymentMethodEnabled('COD')).not.toThrow();
    expect(() => VeterinarianStorePolicy.assertPaymentMethodEnabled('MADA')).toThrow();
    expect(() => VeterinarianStorePolicy.assertPaymentMethodEnabled('CREDIT_CARD')).toThrow();
  });

  it('assertPurchasable enforces ACTIVE + sufficient stock', () => {
    const p = { status: 'ACTIVE', stockQuantity: 5, name: 'x' };
    expect(() => VeterinarianStorePolicy.assertPurchasable(p, 5)).not.toThrow();
    expect(() => VeterinarianStorePolicy.assertPurchasable(p, 6)).toThrow();
    expect(() =>
      VeterinarianStorePolicy.assertPurchasable({ ...p, status: 'INACTIVE' }, 1),
    ).toThrow();
  });

  it('order numbers match VTS-<yyyymmdd>-<6 digits>', () => {
    expect(
      VeterinarianStorePolicy.generateOrderNumber(new Date('2026-09-07T00:00:00Z')),
    ).toMatch(/^VTS-20260907-\d{6}$/);
  });
});
