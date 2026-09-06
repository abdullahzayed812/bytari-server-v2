/**
 * Poultry Farm operations domain constants — the entities behind the Farm
 * Details screen. Text + CHECK enums (not catalogue tables), mirrored by the DB
 * CHECK constraints in `20260912010000_poultry_operations.ts`. Extend via
 * migration.
 */

// --- flocks (poultry_flocks) -------------------------------------

/** Poultry bird types. Text + CHECK (not a catalogue table) — extend via migration. */
export const POULTRY_BIRD_TYPES = ['CHICKEN', 'DUCK', 'TURKEY', 'QUAIL', 'GOOSE', 'OTHER'] as const;
export type PoultryBirdType = (typeof POULTRY_BIRD_TYPES)[number];

/** Poultry flock lifecycle. ACTIVE while the batch is on the farm; CLOSED when finished. */
export const POULTRY_FLOCK_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type PoultryFlockStatus = (typeof POULTRY_FLOCK_STATUSES)[number];

// --- farm profile (farm_details) --------------------------------------

export const POULTRY_PRODUCTION_TYPES = [
  'BROILER',
  'LAYER',
  'MIXED',
  'BREEDER',
  'HATCHERY',
  'OTHER',
] as const;
export type PoultryProductionType = (typeof POULTRY_PRODUCTION_TYPES)[number];

// --- daily records --------------------------------------------------

export const POULTRY_APPETITE_LEVELS = ['GOOD', 'NORMAL', 'WEAK', 'NONE'] as const;
export type PoultryAppetite = (typeof POULTRY_APPETITE_LEVELS)[number];

export const POULTRY_ACTIVITY_LEVELS = ['ACTIVE', 'NORMAL', 'LETHARGIC'] as const;
export type PoultryActivity = (typeof POULTRY_ACTIVITY_LEVELS)[number];

// --- expenses ------------------------------------------------------

export const FARM_EXPENSE_CATEGORIES = [
  'FEED',
  'MEDICINE',
  'WATER_TRANSPORT',
  'LABOR',
  'UTILITIES',
  'EQUIPMENT',
  'OTHER',
] as const;
export type FarmExpenseCategory = (typeof FARM_EXPENSE_CATEGORIES)[number];

// --- health events (treatments & vaccinations) --------------------

export const POULTRY_HEALTH_EVENT_KINDS = ['TREATMENT', 'VACCINATION'] as const;
export type PoultryHealthEventKind = (typeof POULTRY_HEALTH_EVENT_KINDS)[number];

export const POULTRY_HEALTH_EVENT_STATUSES = ['SCHEDULED', 'ONGOING', 'DONE', 'RECOVERED'] as const;
export type PoultryHealthEventStatus = (typeof POULTRY_HEALTH_EVENT_STATUSES)[number];

// --- appointments -------------------------------------------------

export const FARM_APPOINTMENT_CATEGORIES = [
  'VACCINATION',
  'TREATMENT',
  'INDIVIDUAL_CASE',
  'VET_VISIT',
  'OTHER',
] as const;
export type FarmAppointmentCategory = (typeof FARM_APPOINTMENT_CATEGORIES)[number];

export const FARM_APPOINTMENT_STATUSES = ['UPCOMING', 'DONE', 'CANCELLED'] as const;
export type FarmAppointmentStatus = (typeof FARM_APPOINTMENT_STATUSES)[number];

// --- individual cases ------------------------------------------

export const POULTRY_CASE_SEXES = ['MALE', 'FEMALE', 'UNKNOWN'] as const;
export type PoultryCaseSex = (typeof POULTRY_CASE_SEXES)[number];

export const POULTRY_CASE_STATUSES = ['UNDER_TREATMENT', 'RECOVERED', 'DECEASED'] as const;
export type PoultryCaseStatus = (typeof POULTRY_CASE_STATUSES)[number];

/**
 * Audit actions for Poultry Farm operations. `AuditService` takes free-form
 * strings (see `audit.types.ts`), so — like the content-tips module — these
 * live with the domain instead of the central catalogue.
 */
export const PoultryOpsAuditAction = {
  FARM_PROFILE_UPDATED: 'FARM_PROFILE_UPDATED',
  POULTRY_DAILY_RECORD_CREATED: 'POULTRY_DAILY_RECORD_CREATED',
  POULTRY_DAILY_RECORD_UPDATED: 'POULTRY_DAILY_RECORD_UPDATED',
  POULTRY_DAILY_RECORD_DELETED: 'POULTRY_DAILY_RECORD_DELETED',
  FARM_EXPENSE_CREATED: 'FARM_EXPENSE_CREATED',
  FARM_EXPENSE_UPDATED: 'FARM_EXPENSE_UPDATED',
  FARM_EXPENSE_DELETED: 'FARM_EXPENSE_DELETED',
  POULTRY_HEALTH_EVENT_CREATED: 'POULTRY_HEALTH_EVENT_CREATED',
  POULTRY_HEALTH_EVENT_UPDATED: 'POULTRY_HEALTH_EVENT_UPDATED',
  POULTRY_HEALTH_EVENT_DELETED: 'POULTRY_HEALTH_EVENT_DELETED',
  FARM_APPOINTMENT_CREATED: 'FARM_APPOINTMENT_CREATED',
  FARM_APPOINTMENT_UPDATED: 'FARM_APPOINTMENT_UPDATED',
  FARM_APPOINTMENT_DELETED: 'FARM_APPOINTMENT_DELETED',
  POULTRY_CASE_CREATED: 'POULTRY_CASE_CREATED',
  POULTRY_CASE_UPDATED: 'POULTRY_CASE_UPDATED',
  POULTRY_CASE_DELETED: 'POULTRY_CASE_DELETED',
} as const;

export const PoultryOpsAuditEntity = {
  FARM_PROFILE: 'FARM_PROFILE',
  POULTRY_DAILY_RECORD: 'POULTRY_DAILY_RECORD',
  FARM_EXPENSE: 'FARM_EXPENSE',
  POULTRY_HEALTH_EVENT: 'POULTRY_HEALTH_EVENT',
  FARM_APPOINTMENT: 'FARM_APPOINTMENT',
  POULTRY_CASE: 'POULTRY_CASE',
} as const;
