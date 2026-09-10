/**
 * Veterinary Office product domain constants.
 *
 * A Veterinary Office is an Organization of type `VETERINARY_OFFICE`
 * (Phase 3). This module owns ONLY `veterinary_office_products` — a
 * Veterinary Store's catalog is a fully separate table/module
 * (`veterinary-store`), never this one. Ownership, membership, roles and
 * organization authorization are reused unchanged from the `organizations`
 * module.
 */

/** The one organization type this catalog belongs to (DB-pinned via composite FK). */
export const VETERINARY_OFFICE_ORG_TYPE = 'VETERINARY_OFFICE' as const;

/**
 * Veterinary product categories, matching the product filter chips shown in
 * the mobile catalog screens. Text + CHECK, not a catalogue table — extend
 * the CHECK via migration if another category is ever needed. Shared with
 * `veterinary-store` by convention (same real-world categories), not by any
 * code/table reference.
 */
export const VETERINARY_OFFICE_PRODUCT_TYPES = [
  'MEDICINE',
  'EQUIPMENT_SUPPLY',
  'SUPPLEMENT',
  'CARE',
] as const;
export type VeterinaryOfficeProductType = (typeof VETERINARY_OFFICE_PRODUCT_TYPES)[number];

/** Product image limits — same shape as the organization gallery / Pet Owners Store seams. */
export const VETERINARY_OFFICE_MAX_PRODUCT_IMAGES = 6;
export const VETERINARY_OFFICE_MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024;
export const VETERINARY_OFFICE_ALLOWED_PRODUCT_IMAGE_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export const VETERINARY_OFFICE_PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS = 900;
/** Seconds a signed GET URL for a product image stays valid (public-URL setups never use this). */
export const VETERINARY_OFFICE_PRODUCT_IMAGE_URL_TTL_SECONDS = 3600;

/** Product lifecycle. `INACTIVE` is the soft-delete state. */
export const VETERINARY_OFFICE_PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type VeterinaryOfficeProductStatus = (typeof VETERINARY_OFFICE_PRODUCT_STATUSES)[number];

/**
 * Organization-RBAC permission keys — deliberately the SAME keys as
 * `veterinary-store` (`product.read/create/update/delete/inventory.adjust`).
 * Organization permissions are always checked against one specific
 * organization instance (`assertInOrganization(principal, permission,
 * thisOrgId)`), the same way `organization.update` / `member.read` are
 * already shared across every organization type — reusing the key never lets
 * a Store permission grant reach an Office (or vice versa); only the
 * underlying table/repository/service, which are fully separate, decide what
 * data is touched.
 */
export const VETERINARY_PRODUCT_ORG_PERMISSION_KEYS = [
  'product.read',
  'product.create',
  'product.update',
  'product.delete',
  'product.inventory.adjust',
] as const;
