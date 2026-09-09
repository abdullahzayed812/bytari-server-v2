import { randomInt } from 'node:crypto';
import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  PET_STORE_ENABLED_PAYMENT_METHODS,
  PET_STORE_MAX_ITEM_QUANTITY,
  PET_STORE_ORDER_TRANSITIONS,
  type PetStoreOrderStatus,
  type PetStorePaymentMethod,
} from './pet-owner-store.constants.js';

/**
 * Pet Owners Store business rules. Pure — no I/O. Deliberately store-agnostic
 * (takes plain product/line data, not a `pet_owner_store_*` row) so a future
 * Veterinarians Store can reuse it unchanged.
 */

// --- money (integer minor units — never a JS float) -------------------

/** Parse a `numeric(12,2)` decimal string to integer minor units (halalas). */
export function toMinorUnits(decimal: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal.trim());
  if (!m) throw new BadRequestError(`Invalid money value: "${decimal}"`);
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return whole * 100 + Number(frac);
}

/** Render integer minor units back to a `numeric(12,2)` decimal string. */
export function fromMinorUnits(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function addMoney(a: string, b: string): string {
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));
}

export function multiplyMoney(amount: string, factor: number): string {
  if (!Number.isInteger(factor) || factor < 0) {
    throw new BadRequestError('quantity must be a non-negative integer');
  }
  return fromMinorUnits(toMinorUnits(amount) * factor);
}

// --- cart / checkout -------------------------------------------------

export interface PricedLine {
  unitPrice: string;
  quantity: number;
}

export interface CartTotals {
  subtotalAmount: string;
  deliveryFee: string;
  totalAmount: string;
}

export const PetOwnerStorePolicy = {
  /** Clamp / validate a requested cart quantity. */
  assertQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestError('quantity must be a positive integer');
    }
    if (quantity > PET_STORE_MAX_ITEM_QUANTITY) {
      throw new BadRequestError(`quantity may not exceed ${PET_STORE_MAX_ITEM_QUANTITY}`);
    }
  },

  /** A product must be purchasable (ACTIVE) and have enough stock. */
  assertPurchasable(
    product: { status: string; stockQuantity: number; name: string },
    quantity: number,
  ): void {
    if (product.status !== 'ACTIVE') {
      throw new ConflictError(`"${product.name}" is no longer available`, {
        code: ErrorCode.CONFLICT,
      });
    }
    if (product.stockQuantity < quantity) {
      throw new ConflictError(`"${product.name}" does not have enough stock`, {
        code: ErrorCode.INSUFFICIENT_STOCK,
      });
    }
  },

  /** Sum lines + delivery fee. All inputs/outputs are decimal strings. */
  computeTotals(lines: PricedLine[], deliveryFee: string): CartTotals {
    let subtotal = 0;
    for (const line of lines) subtotal += toMinorUnits(line.unitPrice) * line.quantity;
    const subtotalAmount = fromMinorUnits(subtotal);
    return {
      subtotalAmount,
      deliveryFee: fromMinorUnits(toMinorUnits(deliveryFee)),
      totalAmount: fromMinorUnits(subtotal + toMinorUnits(deliveryFee)),
    };
  },

  /** Only Cash on Delivery is wired up right now. */
  assertPaymentMethodEnabled(method: PetStorePaymentMethod): void {
    if (!(PET_STORE_ENABLED_PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestError(
        `Payment method "${method}" is not available yet — only Cash on Delivery is supported`,
        { code: ErrorCode.BAD_REQUEST },
      );
    }
  },

  assertCartNotEmpty(lineCount: number): void {
    if (lineCount === 0) {
      throw new BadRequestError('Your cart is empty', { code: ErrorCode.BAD_REQUEST });
    }
  },

  /** Signed stock delta with a non-negative floor (also guarded by a DB CHECK). */
  applyStockDelta(current: number, delta: number): number {
    const next = current + delta;
    if (next < 0) {
      throw new ConflictError('The adjustment would take stock below zero', {
        code: ErrorCode.INSUFFICIENT_STOCK,
      });
    }
    return next;
  },

  /** Validate an admin order-status change against the allowed transition map. */
  assertOrderTransition(from: PetStoreOrderStatus, to: PetStoreOrderStatus): void {
    if (from === to) {
      throw new BadRequestError(`Order is already ${to}`);
    }
    if (!PET_STORE_ORDER_TRANSITIONS[from].includes(to)) {
      throw new ConflictError(`Cannot move an order from ${from} to ${to}`, {
        code: ErrorCode.CONFLICT,
      });
    }
  },

  /** Human-friendly order reference: `POS-<yyyymmdd>-<6 digits>`. */
  generateOrderNumber(now = new Date()): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `POS-${y}${m}${d}-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  },
} as const;
