/**
 * Sheep/Cattle Farm operations domain constants — shared by both species since
 * the daily-record/health-event/individual-case shapes are identical (mirrors
 * `server/src/modules/farms/domain/poultry-ops.constants.ts`'s equivalents,
 * plus two screenshot-confirmed additions on the daily record: sick-cases
 * count and feed type). Text + CHECK enums (not catalogue tables) — extend via
 * migration, same convention as the poultry module.
 */

// --- farm species discriminator (farm_details.farm_species) --------

export const FARM_SPECIES = ['POULTRY', 'SHEEP', 'CATTLE', 'MIXED'] as const;
export type FarmSpecies = (typeof FARM_SPECIES)[number];

// --- daily records --------------------------------------------------

export const LIVESTOCK_APPETITE_LEVELS = ['GOOD', 'NORMAL', 'WEAK', 'NONE'] as const;
export type LivestockAppetite = (typeof LIVESTOCK_APPETITE_LEVELS)[number];

export const LIVESTOCK_ACTIVITY_LEVELS = ['ACTIVE', 'NORMAL', 'LETHARGIC'] as const;
export type LivestockActivity = (typeof LIVESTOCK_ACTIVITY_LEVELS)[number];

/** New vs. the poultry daily record — نوع العلف (feed type). */
export const LIVESTOCK_FEED_TYPES = ['CONCENTRATED', 'GREEN_FODDER', 'MIXED', 'OTHER'] as const;
export type LivestockFeedType = (typeof LIVESTOCK_FEED_TYPES)[number];

// --- health events (treatments & vaccinations) --------------------

export const LIVESTOCK_HEALTH_EVENT_KINDS = ['TREATMENT', 'VACCINATION'] as const;
export type LivestockHealthEventKind = (typeof LIVESTOCK_HEALTH_EVENT_KINDS)[number];

export const LIVESTOCK_HEALTH_EVENT_STATUSES = ['SCHEDULED', 'ONGOING', 'DONE', 'RECOVERED'] as const;
export type LivestockHealthEventStatus = (typeof LIVESTOCK_HEALTH_EVENT_STATUSES)[number];

// --- individual cases ------------------------------------------

export const LIVESTOCK_CASE_SEXES = ['MALE', 'FEMALE', 'UNKNOWN'] as const;
export type LivestockCaseSex = (typeof LIVESTOCK_CASE_SEXES)[number];

export const LIVESTOCK_CASE_STATUSES = ['UNDER_TREATMENT', 'RECOVERED', 'DECEASED'] as const;
export type LivestockCaseStatus = (typeof LIVESTOCK_CASE_STATUSES)[number];

/**
 * Audit actions for Sheep/Cattle Farm operations — same free-form-string
 * convention as `PoultryOpsAuditAction` (`AuditService` takes free-form
 * strings; see `audit.types.ts`).
 */
export const SheepOpsAuditAction = {
  SHEEP_DAILY_RECORD_CREATED: 'SHEEP_DAILY_RECORD_CREATED',
  SHEEP_DAILY_RECORD_UPDATED: 'SHEEP_DAILY_RECORD_UPDATED',
  SHEEP_DAILY_RECORD_DELETED: 'SHEEP_DAILY_RECORD_DELETED',
  SHEEP_HEALTH_EVENT_CREATED: 'SHEEP_HEALTH_EVENT_CREATED',
  SHEEP_HEALTH_EVENT_UPDATED: 'SHEEP_HEALTH_EVENT_UPDATED',
  SHEEP_HEALTH_EVENT_DELETED: 'SHEEP_HEALTH_EVENT_DELETED',
  SHEEP_CASE_CREATED: 'SHEEP_CASE_CREATED',
  SHEEP_CASE_UPDATED: 'SHEEP_CASE_UPDATED',
  SHEEP_CASE_DELETED: 'SHEEP_CASE_DELETED',
} as const;

export const SheepOpsAuditEntity = {
  SHEEP_DAILY_RECORD: 'SHEEP_DAILY_RECORD',
  SHEEP_HEALTH_EVENT: 'SHEEP_HEALTH_EVENT',
  SHEEP_CASE: 'SHEEP_CASE',
} as const;

export const CattleOpsAuditAction = {
  CATTLE_DAILY_RECORD_CREATED: 'CATTLE_DAILY_RECORD_CREATED',
  CATTLE_DAILY_RECORD_UPDATED: 'CATTLE_DAILY_RECORD_UPDATED',
  CATTLE_DAILY_RECORD_DELETED: 'CATTLE_DAILY_RECORD_DELETED',
  CATTLE_HEALTH_EVENT_CREATED: 'CATTLE_HEALTH_EVENT_CREATED',
  CATTLE_HEALTH_EVENT_UPDATED: 'CATTLE_HEALTH_EVENT_UPDATED',
  CATTLE_HEALTH_EVENT_DELETED: 'CATTLE_HEALTH_EVENT_DELETED',
  CATTLE_CASE_CREATED: 'CATTLE_CASE_CREATED',
  CATTLE_CASE_UPDATED: 'CATTLE_CASE_UPDATED',
  CATTLE_CASE_DELETED: 'CATTLE_CASE_DELETED',
} as const;

export const CattleOpsAuditEntity = {
  CATTLE_DAILY_RECORD: 'CATTLE_DAILY_RECORD',
  CATTLE_HEALTH_EVENT: 'CATTLE_HEALTH_EVENT',
  CATTLE_CASE: 'CATTLE_CASE',
} as const;
