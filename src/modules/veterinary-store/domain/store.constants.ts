/**
 * Phase 10 — Veterinary Store & Products domain constants, later extended to
 * Veterinary Offices (Veterinarian Home § "المكاتب البيطرية").
 *
 * A product-owning organization is a `VETERINARY_STORE` or `VETERINARY_OFFICE`
 * (Phase 3). This module adds only product management; ownership, membership,
 * roles and organization authorization are reused unchanged.
 */

/** Organization types that can own products. */
export const PRODUCT_ORG_TYPES = ['VETERINARY_STORE', 'VETERINARY_OFFICE'] as const;
export type ProductOrgType = (typeof PRODUCT_ORG_TYPES)[number];

/**
 * Veterinary product categories, matching the Veterinary Offices product
 * filter chips. Text + CHECK, not a catalogue table — extend the CHECK via
 * migration if another category is ever needed.
 */
export const PRODUCT_TYPES = ['MEDICINE', 'EQUIPMENT_SUPPLY', 'SUPPLEMENT', 'CARE'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** Product image limits — same shape as the organization gallery / Pet Owners Store seams. */
export const MAX_PRODUCT_IMAGES = 6;
export const MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_PRODUCT_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS = 900;
/** Seconds a signed GET URL for a product image stays valid (public-URL setups never use this). */
export const PRODUCT_IMAGE_URL_TTL_SECONDS = 3600;

/**
 * Product lifecycle. `INACTIVE` is the soft-delete state — products are never
 * physically deleted because docs 04 §4.9 lists Orders / Purchasing as future
 * Veterinary Store concerns that will reference product history.
 */
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * Organization-RBAC permission keys introduced by Phase 10. Mirrored into
 * `ORG_PERMISSION_KEYS` / `ORG_PERMISSION_DEFINITIONS` / `ORG_ROLE_PERMISSIONS`
 * in `organization-rbac.constants.ts` (single source of truth for the seed).
 *
 * `product.inventory.adjust` is deliberately separate from `product.update` —
 * stock changes are a controlled operation, not a free-form field edit.
 */
export const STORE_ORG_PERMISSION_KEYS = [
  'product.read',
  'product.create',
  'product.update',
  'product.delete',
  'product.inventory.adjust',
] as const;
export type StoreOrgPermissionKey = (typeof STORE_ORG_PERMISSION_KEYS)[number];
