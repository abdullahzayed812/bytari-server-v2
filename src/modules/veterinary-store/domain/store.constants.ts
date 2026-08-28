/**
 * Phase 10 — Veterinary Store & Products domain constants.
 *
 * A Veterinary Store is an Organization of type `VETERINARY_STORE` (Phase 3).
 * This module adds only product management; ownership, membership, roles and
 * organization authorization are reused unchanged.
 */

/** The only organization type that can own products (Phase 10 scope). */
export const VETERINARY_STORE_ORG_TYPE = 'VETERINARY_STORE' as const;

/**
 * Confirmed veterinary product types (docs 02 §2.3 / docs 01 §1.7:
 * "Veterinary Medicines / Medical Equipment / Veterinary Supplies"). Text +
 * CHECK, not a catalogue table — extend the CHECK via migration if needed.
 */
export const PRODUCT_TYPES = ['MEDICINE', 'EQUIPMENT', 'SUPPLY', 'OTHER'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

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
