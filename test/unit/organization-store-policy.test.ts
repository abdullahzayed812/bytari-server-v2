import { describe, expect, it } from 'vitest';
import type { AppError } from '../../src/shared/errors/app-error.js';
import { OrganizationStorePolicy } from '../../src/modules/organization-store/domain/organization-store.policy.js';
import { OrganizationPolicy } from '../../src/modules/organizations/domain/organization.policy.js';

const product = {
  organizationId: 'org-1',
  name: 'شامبو',
  status: 'ACTIVE',
  isHidden: false,
  price: '1500.50',
  currency: 'IQD',
};

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as AppError).code;
  }
  return undefined;
}

describe('OrganizationStorePolicy', () => {
  it('only clinics and veterinary offices run a store', () => {
    expect(OrganizationStorePolicy.isStoreOrganizationType('CLINIC')).toBe(true);
    expect(OrganizationStorePolicy.isStoreOrganizationType('VETERINARY_OFFICE')).toBe(true);
    for (const t of ['FARM', 'VETERINARY_STORE', 'SYNDICATE']) {
      expect(OrganizationStorePolicy.isStoreOrganizationType(t)).toBe(false);
    }
  });

  it('a product is purchasable only when it belongs to the store, is ACTIVE, visible and priced', () => {
    expect(() => OrganizationStorePolicy.assertPurchasable(product, 'org-1')).not.toThrow();
    expect(codeOf(() => OrganizationStorePolicy.assertPurchasable(product, 'org-2'))).toBe(
      'BAD_REQUEST',
    );
    for (const bad of [{ status: 'INACTIVE' }, { isHidden: true }, { price: null }]) {
      expect(
        codeOf(() => OrganizationStorePolicy.assertPurchasable({ ...product, ...bad }, 'org-1')),
      ).toBe('PRODUCT_NOT_PURCHASABLE');
    }
  });

  it('one currency per cart', () => {
    expect(() => OrganizationStorePolicy.assertSameCurrency(null, 'USD')).not.toThrow();
    expect(() => OrganizationStorePolicy.assertSameCurrency('IQD', 'IQD')).not.toThrow();
    expect(codeOf(() => OrganizationStorePolicy.assertSameCurrency('IQD', 'USD'))).toBe(
      'STORE_CART_CURRENCY_MISMATCH',
    );
  });

  it('totals use integer minor units', () => {
    expect(
      OrganizationStorePolicy.computeTotals(
        [
          { unitPrice: '0.10', quantity: 3 },
          { unitPrice: '1500.50', quantity: 2 },
        ],
        '0.00',
      ),
    ).toEqual({ subtotalAmount: '3001.30', deliveryFee: '0.00', totalAmount: '3001.30' });
  });

  it('seller transitions follow the store status machine', () => {
    expect(() =>
      OrganizationStorePolicy.assertSellerTransition('PENDING', 'CONFIRMED'),
    ).not.toThrow();
    expect(() =>
      OrganizationStorePolicy.assertSellerTransition('SHIPPED', 'DELIVERED'),
    ).not.toThrow();
    expect(
      codeOf(() => OrganizationStorePolicy.assertSellerTransition('PENDING', 'DELIVERED')),
    ).toBe('ORDER_INVALID_TRANSITION');
    expect(
      codeOf(() => OrganizationStorePolicy.assertSellerTransition('DELIVERED', 'CANCELLED')),
    ).toBe('ORDER_INVALID_TRANSITION');
  });

  it('the customer may cancel only a PENDING order', () => {
    expect(() => OrganizationStorePolicy.assertCustomerCanCancel('PENDING')).not.toThrow();
    for (const s of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const) {
      expect(codeOf(() => OrganizationStorePolicy.assertCustomerCanCancel(s))).toBe(
        'ORDER_INVALID_TRANSITION',
      );
    }
  });

  it('order numbers carry the store kind', () => {
    const at = new Date(Date.UTC(2026, 10, 3));
    expect(OrganizationStorePolicy.generateOrderNumber('CLINIC', at)).toMatch(
      /^CLS-20261103-\d{6}$/,
    );
    expect(OrganizationStorePolicy.generateOrderNumber('VETERINARY_OFFICE', at)).toMatch(
      /^OFS-20261103-\d{6}$/,
    );
  });
});

describe('OrganizationPolicy.assertCanBeSupervisor — store supervisors', () => {
  const nonVet = { veterinarianStatus: 'NONE' };
  it('lets an existing non-vet member of a clinic / office hold store + staff keys only', () => {
    for (const type of ['CLINIC', 'VETERINARY_OFFICE'] as const) {
      expect(() =>
        OrganizationPolicy.assertCanBeSupervisor(type, nonVet, {
          isActiveMember: true,
          permissions: [
            'store.order.read',
            'store.order.manage',
            'product.create',
            'medical_record.read',
          ],
        }),
      ).not.toThrow();
    }
  });
  it('refuses management keys, non-members and other organization types', () => {
    const cases: Array<
      [Parameters<typeof OrganizationPolicy.assertCanBeSupervisor>[0], boolean, string[]]
    > = [
      ['CLINIC', true, ['store.order.read', 'supervisor.assign']],
      ['CLINIC', false, ['store.order.read']],
      ['FARM', true, ['store.order.read']],
      ['VETERINARY_STORE', true, ['product.read']],
    ];
    for (const [type, isActiveMember, permissions] of cases) {
      expect(
        codeOf(() =>
          OrganizationPolicy.assertCanBeSupervisor(type, nonVet, { isActiveMember, permissions }),
        ),
      ).toBe('VETERINARIAN_APPROVAL_REQUIRED');
    }
  });
  it('an approved veterinarian may still hold any keys', () => {
    expect(() =>
      OrganizationPolicy.assertCanBeSupervisor('CLINIC', { veterinarianStatus: 'APPROVED' }),
    ).not.toThrow();
  });
});
