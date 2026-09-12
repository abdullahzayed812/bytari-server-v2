/**
 * Veterinarian Store — domain constants.
 *
 * A platform-run consumer storefront with its own dedicated tables
 * (`veterinarian_store_*`). Consumer browse / cart / checkout / order history are
 * authentication-only; catalogue + order management require ADMIN or an ACTIVE
 * `VETERINARIAN_STORE` system-supervisor (RBAC keys below, mirrored in
 * `rbac.constants.ts`).
 *
 * This mirrors the Pet Owners Store (`modules/pet-owner-store/`) — same
 * commerce policy shape, its own dedicated tables and catalogue — for
 * Veterinarian-mode users. Products/categories here are completely separate
 * from `pet_owner_store_*` and from the org-scoped `veterinary_store_products`
 * / `veterinary_office_products` catalogues (those belong to VETERINARY_STORE
 * / VETERINARY_OFFICE organizations, not to the platform).
 */

export const VETERINARIAN_STORE_PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type VeterinarianStoreProductStatus = (typeof VETERINARIAN_STORE_PRODUCT_STATUSES)[number];

export const VETERINARIAN_STORE_CATEGORY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type VeterinarianStoreCategoryStatus = (typeof VETERINARIAN_STORE_CATEGORY_STATUSES)[number];

/**
 * Payment methods rendered at checkout. Only `COD` is accepted by the service
 * today — `MADA` / `CREDIT_CARD` exist so the mobile UI can show the disabled
 * "coming soon" rows and so the enum is ready for a future gateway.
 */
export const VETERINARIAN_STORE_PAYMENT_METHODS = ['COD', 'MADA', 'CREDIT_CARD'] as const;
export type VeterinarianStorePaymentMethod = (typeof VETERINARIAN_STORE_PAYMENT_METHODS)[number];
export const VETERINARIAN_STORE_ENABLED_PAYMENT_METHODS = ['COD'] as const;

export const VETERINARIAN_STORE_PAYMENT_STATUSES = ['UNPAID', 'PAID', 'REFUNDED'] as const;
export type VeterinarianStorePaymentStatus = (typeof VETERINARIAN_STORE_PAYMENT_STATUSES)[number];

export const VETERINARIAN_STORE_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type VeterinarianStoreOrderStatus = (typeof VETERINARIAN_STORE_ORDER_STATUSES)[number];

/**
 * Allowed forward transitions for an order's status. `CANCELLED` is reachable
 * from any non-terminal state; `DELIVERED` and `CANCELLED` are terminal.
 */
export const VETERINARIAN_STORE_ORDER_TRANSITIONS: Record<VeterinarianStoreOrderStatus, VeterinarianStoreOrderStatus[]> = {
  PENDING: ['CONFIRMED', 'PROCESSING', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'SHIPPED', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

/** Free delivery for now — reference shows "توصيل مجاني". */
export const VETERINARIAN_STORE_DELIVERY_FEE = '0.00';
export const VETERINARIAN_STORE_CURRENCY = 'SAR';

/** Per-line and per-cart quantity ceilings (guards abuse, not a business rule). */
export const VETERINARIAN_STORE_MAX_ITEM_QUANTITY = 99;

/** Seconds a signed product-image URL stays valid (no public base URL configured). */
export const VETERINARIAN_STORE_IMAGE_URL_TTL_SECONDS = 3600;
/** Seconds a direct-to-R2 upload URL stays valid. */
export const VETERINARIAN_STORE_UPLOAD_URL_TTL_SECONDS = 600;

/** 5 MiB — product photos. */
export const VETERINARIAN_STORE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const VETERINARIAN_STORE_ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type VeterinarianStoreImageMime = (typeof VETERINARIAN_STORE_ALLOWED_IMAGE_MIME)[number];

/** Max gallery images per product. */
export const VETERINARIAN_STORE_MAX_PRODUCT_IMAGES = 8;

/** Storage key prefix for Veterinarian Store media (R2). */
export const VETERINARIAN_STORE_STORAGE_PREFIX = 'veterinarian-store';

export const VETERINARIAN_STORE_PRODUCT_SORTS = ['name', 'price', 'createdAt'] as const;
export type VeterinarianStoreProductSort = (typeof VETERINARIAN_STORE_PRODUCT_SORTS)[number];

// --- RBAC keys (mirrored in modules/rbac/rbac.constants.ts) ------------

export const VETERINARIAN_STORE_PERMISSION_KEYS = [
  'veterinarian_store.product.manage',
  'veterinarian_store.category.manage',
  'veterinarian_store.order.manage',
] as const;
export type VeterinarianStorePermissionKey = (typeof VETERINARIAN_STORE_PERMISSION_KEYS)[number];

export const VETERINARIAN_STORE_SUPERVISOR_DOMAIN = 'VETERINARIAN_STORE' as const;
