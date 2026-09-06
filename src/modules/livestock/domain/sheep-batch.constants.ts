/**
 * Sheep Farms domain constants — mirrors
 * `server/src/modules/farms/domain/poultry-ops.constants.ts`'s flock-level
 * constants exactly, with the bird-type picker replaced by an age/sex
 * headcount breakdown (lambs/males/females) since a sheep batch does not mix
 * multiple animal species the way a poultry flock's `birdType` implies.
 */

/** Sheep batch lifecycle. ACTIVE while the batch is on the farm; CLOSED when finished. */
export const SHEEP_BATCH_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type SheepBatchStatus = (typeof SHEEP_BATCH_STATUSES)[number];

/** Sheep farm production focus (farm_details.sheep_production_type). */
export const SHEEP_PRODUCTION_TYPES = ['MEAT', 'DAIRY', 'WOOL', 'BREEDING', 'MIXED', 'OTHER'] as const;
export type SheepProductionType = (typeof SHEEP_PRODUCTION_TYPES)[number];
