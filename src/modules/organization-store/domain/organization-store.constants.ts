/**
 * Organization Store — cart, checkout, orders and order tracking for the
 * stores run BY an organization: the Clinic Store (CLINIC) and the Veterinary
 * Office Store (VETERINARY_OFFICE).
 *
 * Products are the organization's own catalogue (`veterinary_office_products`,
 * managed by `modules/veterinary-office` under the `product.*` org
 * permissions). This module adds only the commerce layer on top, mirroring the
 * platform stores (`pet-owner-store`, `veterinarian-store`): same order status
 * machine, COD-only checkout, name / price snapshots — but every cart and order
 * belongs to exactly ONE organization, and the seller side is the
 * organization's owner + members holding `store.order.*`.
 *
 * Office / clinic products have no inventory (no stock field in the product
 * forms), so checkout never checks or decrements stock: a product is
 * purchasable while it is ACTIVE, not hidden and priced.
 */
import type { OrgPermissionKey } from '../../organizations/domain/organization-rbac.constants.js';

export { STORE_ORGANIZATION_TYPES } from '../../organizations/domain/organization-rbac.constants.js';

export const ORGANIZATION_STORE_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type OrganizationStoreOrderStatus = (typeof ORGANIZATION_STORE_ORDER_STATUSES)[number];

/**
 * Seller-side transitions — identical to the platform stores' machine.
 * `CANCELLED` is reachable from any non-terminal state; `DELIVERED` and
 * `CANCELLED` are terminal.
 */
export const ORGANIZATION_STORE_ORDER_TRANSITIONS: Record<
  OrganizationStoreOrderStatus,
  OrganizationStoreOrderStatus[]
> = {
  PENDING: ['CONFIRMED', 'PROCESSING', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'SHIPPED', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

/** The customer may cancel their own order only before the seller accepted it. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly OrganizationStoreOrderStatus[] = ['PENDING'];

/** Only Cash on Delivery is accepted (same as the platform stores). */
export const ORGANIZATION_STORE_PAYMENT_METHODS = ['COD'] as const;
export type OrganizationStorePaymentMethod = (typeof ORGANIZATION_STORE_PAYMENT_METHODS)[number];

export const ORGANIZATION_STORE_PAYMENT_STATUSES = ['UNPAID', 'PAID', 'REFUNDED'] as const;

/**
 * Delivery is settled with the seller on delivery — `0.00` means "not included
 * in the total", NOT free delivery (same convention as the platform stores).
 */
export const ORGANIZATION_STORE_DELIVERY_FEE = '0.00';

export const ORGANIZATION_STORE_MAX_ITEM_QUANTITY = 99;
/** Distinct lines per cart (abuse guard, not a business rule). */
export const ORGANIZATION_STORE_MAX_CART_LINES = 50;

export const ORDER_ACTOR_SIDES = ['CUSTOMER', 'SELLER'] as const;
export type OrderActorSide = (typeof ORDER_ACTOR_SIDES)[number];

/** Org-RBAC keys for the seller's incoming orders (products reuse `product.*`). */
export const STORE_ORDER_READ_PERMISSION = 'store.order.read' satisfies OrgPermissionKey;
export const STORE_ORDER_MANAGE_PERMISSION = 'store.order.manage' satisfies OrgPermissionKey;
