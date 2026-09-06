/**
 * Phase 6 — Farms domain constants. A Farm is an Organization of type FARM
 * (Phase 3). This module adds only farm-specific behaviour — the join-code
 * flow, subscription, and (per species) batch-tracking domains. It never
 * re-implements ownership, membership, roles, permissions or org
 * authorization.
 *
 * Poultry-specific constants (bird types, flock statuses, production types)
 * live in `poultry-ops.constants.ts` — this file holds only what is genuinely
 * shared across every farm species (poultry, sheep, cattle).
 */

/** Organization type that carries farm behaviour (Phase 6 scope). */
export const FARM_ORG_TYPE = 'FARM' as const;
