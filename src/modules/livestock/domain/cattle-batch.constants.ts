/**
 * Cattle Farms domain constants — mirrors `sheep-batch.constants.ts` exactly;
 * a cattle batch's age/sex headcount breakdown is calves/bulls/cows instead of
 * lambs/males/females.
 */

export const CATTLE_BATCH_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type CattleBatchStatus = (typeof CATTLE_BATCH_STATUSES)[number];

/** Cattle farm production focus (farm_details.cattle_production_type). */
export const CATTLE_PRODUCTION_TYPES = ['DAIRY', 'BEEF', 'BREEDING', 'MIXED', 'OTHER'] as const;
export type CattleProductionType = (typeof CATTLE_PRODUCTION_TYPES)[number];
