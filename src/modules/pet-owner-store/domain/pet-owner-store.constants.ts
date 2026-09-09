/**
 * Pet Owners Store — domain constants.
 *
 * A platform-run consumer storefront with its own dedicated tables
 * (`pet_owner_store_*`). Consumer browse / cart / checkout / order history are
 * authentication-only; catalogue + order management require ADMIN or an ACTIVE
 * `PET_OWNER_STORE` system-supervisor (RBAC keys below, mirrored in
 * `rbac.constants.ts`).
 *
 * The generic commerce logic in `pet-owner-store.policy.ts` is deliberately
 * store-agnostic so a future Veterinarians Store can reuse it against its own
 * tables.
 */

export const PET_STORE_PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PetStoreProductStatus = (typeof PET_STORE_PRODUCT_STATUSES)[number];

export const PET_STORE_CATEGORY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PetStoreCategoryStatus = (typeof PET_STORE_CATEGORY_STATUSES)[number];

/**
 * Payment methods rendered at checkout. Only `COD` is accepted by the service
 * today — `MADA` / `CREDIT_CARD` exist so the mobile UI can show the disabled
 * "coming soon" rows and so the enum is ready for a future gateway.
 */
export const PET_STORE_PAYMENT_METHODS = ['COD', 'MADA', 'CREDIT_CARD'] as const;
export type PetStorePaymentMethod = (typeof PET_STORE_PAYMENT_METHODS)[number];
export const PET_STORE_ENABLED_PAYMENT_METHODS = ['COD'] as const;

export const PET_STORE_PAYMENT_STATUSES = ['UNPAID', 'PAID', 'REFUNDED'] as const;
export type PetStorePaymentStatus = (typeof PET_STORE_PAYMENT_STATUSES)[number];

export const PET_STORE_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type PetStoreOrderStatus = (typeof PET_STORE_ORDER_STATUSES)[number];

/**
 * Allowed forward transitions for an order's status. `CANCELLED` is reachable
 * from any non-terminal state; `DELIVERED` and `CANCELLED` are terminal.
 */
export const PET_STORE_ORDER_TRANSITIONS: Record<PetStoreOrderStatus, PetStoreOrderStatus[]> = {
  PENDING: ['CONFIRMED', 'PROCESSING', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'SHIPPED', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

/** Free delivery for now — reference shows "توصيل مجاني". */
export const PET_STORE_DELIVERY_FEE = '0.00';
export const PET_STORE_CURRENCY = 'SAR';

/** Per-line and per-cart quantity ceilings (guards abuse, not a business rule). */
export const PET_STORE_MAX_ITEM_QUANTITY = 99;

/** Seconds a signed product-image URL stays valid (no public base URL configured). */
export const PET_STORE_IMAGE_URL_TTL_SECONDS = 3600;
/** Seconds a direct-to-R2 upload URL stays valid. */
export const PET_STORE_UPLOAD_URL_TTL_SECONDS = 600;

/** 5 MiB — product photos. */
export const PET_STORE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PET_STORE_ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type PetStoreImageMime = (typeof PET_STORE_ALLOWED_IMAGE_MIME)[number];

/** Max gallery images per product. */
export const PET_STORE_MAX_PRODUCT_IMAGES = 8;

/** Storage key prefix for Pet Owners Store media (R2). */
export const PET_STORE_STORAGE_PREFIX = 'pet-owner-store';

export const PET_STORE_PRODUCT_SORTS = ['name', 'price', 'createdAt'] as const;
export type PetStoreProductSort = (typeof PET_STORE_PRODUCT_SORTS)[number];

// --- RBAC keys (mirrored in modules/rbac/rbac.constants.ts) ------------

export const PET_STORE_PERMISSION_KEYS = [
  'pet_store.product.manage',
  'pet_store.category.manage',
  'pet_store.order.manage',
] as const;
export type PetStorePermissionKey = (typeof PET_STORE_PERMISSION_KEYS)[number];

export const PET_STORE_SUPERVISOR_DOMAIN = 'PET_OWNER_STORE' as const;
