/**
 * Phase 10 — Veterinary Store product domain constants.
 *
 * A Veterinary Store is an Organization of type `VETERINARY_STORE` (Phase 3).
 * This module owns ONLY `veterinary_store_products` — a Veterinary Office's
 * catalog is a fully separate table/module (`veterinary-office-products`),
 * never this one. Ownership, membership, roles and organization authorization
 * are reused unchanged from the `organizations` module.
 */

/** The one organization type this catalog belongs to (DB-pinned via composite FK). */
export const VETERINARY_STORE_ORG_TYPE = 'VETERINARY_STORE' as const;

/**
 * Veterinary product categories, matching the product filter chips shown in
 * the mobile catalog screens. Text + CHECK, not a catalogue table — extend
 * the CHECK via migration if another category is ever needed. Shared with
 * `veterinary-office-products` by convention (same real-world categories),
 * not by any code/table reference.
 */
export const VETERINARY_STORE_PRODUCT_TYPES = [
  'MEDICINE',
  'EQUIPMENT_SUPPLY',
  'SUPPLEMENT',
  'CARE',
] as const;
export type VeterinaryStoreProductType = (typeof VETERINARY_STORE_PRODUCT_TYPES)[number];

/** Product image limits — same shape as the organization gallery / Pet Owners Store seams. */
export const VETERINARY_STORE_MAX_PRODUCT_IMAGES = 6;
export const VETERINARY_STORE_MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024;
export const VETERINARY_STORE_ALLOWED_PRODUCT_IMAGE_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export const VETERINARY_STORE_PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS = 900;
/** Seconds a signed GET URL for a product image stays valid (public-URL setups never use this). */
export const VETERINARY_STORE_PRODUCT_IMAGE_URL_TTL_SECONDS = 3600;

/**
 * Product lifecycle. `INACTIVE` is the soft-delete state — products are never
 * physically deleted because docs 04 §4.9 lists Orders / Purchasing as future
 * Veterinary Store concerns that will reference product history.
 */
export const VETERINARY_STORE_PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type VeterinaryStoreProductStatus = (typeof VETERINARY_STORE_PRODUCT_STATUSES)[number];

/**
 * Organization-RBAC permission keys introduced by Phase 10. Mirrored into
 * `ORG_PERMISSION_KEYS` / `ORG_PERMISSION_DEFINITIONS` / `ORG_ROLE_PERMISSIONS`
 * in `organization-rbac.constants.ts` (single source of truth for the seed).
 * Deliberately reused as-is by `veterinary-office-products` too: organization
 * permissions are always checked against one specific organization instance
 * (`assertInOrganization(principal, permission, thisOrgId)`), the same way
 * `organization.update` / `member.read` are already shared across every
 * organization type — reusing the key never lets a Store permission grant
 * reach an Office (or vice versa).
 *
 * `product.inventory.adjust` is deliberately separate from `product.update` —
 * stock changes are a controlled operation, not a free-form field edit.
 */
export const VETERINARY_PRODUCT_ORG_PERMISSION_KEYS = [
  'product.read',
  'product.create',
  'product.update',
  'product.delete',
  'product.inventory.adjust',
] as const;
export type VeterinaryProductOrgPermissionKey =
  (typeof VETERINARY_PRODUCT_ORG_PERMISSION_KEYS)[number];
