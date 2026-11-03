import { randomInt } from 'node:crypto';
import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  fromMinorUnits,
  multiplyMoney,
  toMinorUnits,
} from '../../veterinarian-store/domain/veterinarian-store.policy.js';
import {
  CUSTOMER_CANCELLABLE_STATUSES,
  ORGANIZATION_STORE_MAX_ITEM_QUANTITY,
  ORGANIZATION_STORE_ORDER_TRANSITIONS,
  ORGANIZATION_STORE_PAYMENT_METHODS,
  STORE_ORGANIZATION_TYPES,
  type OrganizationStoreOrderStatus,
} from './organization-store.constants.js';

export { multiplyMoney };

/** The product fields the purchase rules look at. */
export interface PurchasableProduct {
  organizationId: string;
  name: string;
  status: string;
  isHidden: boolean;
  price: string | null;
  currency: string;
}

export interface PricedLine {
  unitPrice: string;
  quantity: number;
}

/**
 * Organization Store business rules. Pure — no I/O. Money math reuses the
 * platform stores' integer-minor-unit helpers (never a JS float).
 */
export const OrganizationStorePolicy = {
  /** Only a CLINIC or VETERINARY_OFFICE runs a store with orders. */
  isStoreOrganizationType(type: string): boolean {
    return (STORE_ORGANIZATION_TYPES as readonly string[]).includes(type);
  },

  assertQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestError('quantity must be a positive integer');
    }
    if (quantity > ORGANIZATION_STORE_MAX_ITEM_QUANTITY) {
      throw new BadRequestError(`quantity may not exceed ${ORGANIZATION_STORE_MAX_ITEM_QUANTITY}`);
    }
  },

  /**
   * A product can be bought from `organizationId`'s store while it belongs to
   * that organization, is ACTIVE, not hidden, and has a price. (Office /
   * clinic products carry no inventory, so there is no stock rule.)
   */
  assertPurchasable(product: PurchasableProduct, organizationId: string): void {
    if (product.organizationId !== organizationId) {
      throw new BadRequestError('This product belongs to another store', {
        code: ErrorCode.BAD_REQUEST,
      });
    }
    if (product.status !== 'ACTIVE' || product.isHidden) {
      throw new ConflictError(`"${product.name}" is no longer available`, {
        code: ErrorCode.PRODUCT_NOT_PURCHASABLE,
      });
    }
    if (product.price === null) {
      throw new ConflictError(`"${product.name}" has no price and cannot be ordered`, {
        code: ErrorCode.PRODUCT_NOT_PURCHASABLE,
      });
    }
  },

  /** One order = one currency: every line of a cart must share it. */
  assertSameCurrency(existing: string | null, incoming: string): void {
    if (existing !== null && existing !== incoming) {
      throw new ConflictError(
        `This cart is priced in ${existing}; a ${incoming} product must be ordered separately`,
        { code: ErrorCode.STORE_CART_CURRENCY_MISMATCH },
      );
    }
  },

  assertCartNotEmpty(lineCount: number): void {
    if (lineCount === 0) {
      throw new BadRequestError('Your cart is empty', { code: ErrorCode.BAD_REQUEST });
    }
  },

  assertPaymentMethodEnabled(method: string): void {
    if (!(ORGANIZATION_STORE_PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestError(
        `Payment method "${method}" is not available — only Cash on Delivery is supported`,
        { code: ErrorCode.BAD_REQUEST },
      );
    }
  },

  computeTotals(
    lines: PricedLine[],
    deliveryFee: string,
  ): { subtotalAmount: string; deliveryFee: string; totalAmount: string } {
    let subtotal = 0;
    for (const line of lines) subtotal += toMinorUnits(line.unitPrice) * line.quantity;
    const fee = toMinorUnits(deliveryFee);
    return {
      subtotalAmount: fromMinorUnits(subtotal),
      deliveryFee: fromMinorUnits(fee),
      totalAmount: fromMinorUnits(subtotal + fee),
    };
  },

  /** Seller-side status change against the transition map. */
  assertSellerTransition(
    from: OrganizationStoreOrderStatus,
    to: OrganizationStoreOrderStatus,
  ): void {
    if (from === to) throw new BadRequestError(`Order is already ${to}`);
    if (!ORGANIZATION_STORE_ORDER_TRANSITIONS[from].includes(to)) {
      throw new ConflictError(`Cannot move an order from ${from} to ${to}`, {
        code: ErrorCode.ORDER_INVALID_TRANSITION,
      });
    }
  },

  /** The customer may only cancel, and only while the order is still PENDING. */
  assertCustomerCanCancel(from: OrganizationStoreOrderStatus): void {
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(from)) {
      throw new ConflictError(
        'The store has already accepted this order — contact the store to cancel it',
        { code: ErrorCode.ORDER_INVALID_TRANSITION },
      );
    }
  },

  /** `CLS-…` (clinic) / `OFS-…` (office) + `<yyyymmdd>-<6 digits>`. */
  generateOrderNumber(organizationType: string, now = new Date()): string {
    const prefix = organizationType === 'CLINIC' ? 'CLS' : 'OFS';
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${prefix}-${y}${m}${d}-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  },
} as const;
