/**
 * Phase 6 — Farms & Poultry domain constants.
 *
 * A Farm is an Organization of type FARM (Phase 3). This module adds only
 * farm-specific behaviour — the join-code flow and the poultry domain. It never
 * re-implements ownership, membership, roles, permissions or org authorization.
 */

/** Organization type that carries farm behaviour (Phase 6 scope). */
export const FARM_ORG_TYPE = 'FARM' as const;

/** Poultry bird types. Text + CHECK (not a catalogue table) — extend via migration. */
export const POULTRY_BIRD_TYPES = ['CHICKEN', 'DUCK', 'TURKEY', 'QUAIL', 'GOOSE', 'OTHER'] as const;
export type PoultryBirdType = (typeof POULTRY_BIRD_TYPES)[number];

/** Poultry flock lifecycle. ACTIVE while the batch is on the farm; CLOSED when finished. */
export const POULTRY_FLOCK_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type PoultryFlockStatus = (typeof POULTRY_FLOCK_STATUSES)[number];

/**
 * Organization-RBAC permission keys introduced by Phase 6. Mirrored into
 * `ORG_PERMISSION_KEYS` / `ORG_PERMISSION_DEFINITIONS` / `ORG_ROLE_PERMISSIONS`
 * in `organization-rbac.constants.ts` (single source of truth for the seed).
 *
 * The join-code flow needs NO new permission (joining is gated on APPROVED-vet
 * status; regeneration reuses `organization.update`).
 */
export const FARM_ORG_PERMISSION_KEYS = [
  'farm.poultry.read',
  'farm.poultry.create',
  'farm.poultry.update',
  'farm.poultry.delete',
] as const;
export type FarmOrgPermissionKey = (typeof FARM_ORG_PERMISSION_KEYS)[number];
