import type {
  FarmAppointmentCategory,
  FarmAppointmentStatus,
  FarmCategory,
  FarmExpenseCategory,
  PoultryActivity,
  PoultryAppetite,
  PoultryCaseSex,
  PoultryCaseStatus,
  PoultryHealthEventKind,
  PoultryHealthEventStatus,
} from './poultry-ops.constants.js';

/**
 * Poultry Farm operations DTOs + row mappers. Convention (matches
 * `veterinary-store`): DB `numeric` columns surface as **strings** (pg returns
 * them so; never coerced to float), integer columns as numbers, dates as
 * `YYYY-MM-DD`. Server-computed summary figures are the exception — they are
 * numbers, rounded in the service.
 */

function dateOnly(v: string | Date | null): string | null {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}
function num(v: string | number | null): string | null {
  if (v === null) return null;
  return String(v);
}
function iso(v: Date): string {
  return v.toISOString();
}

// =====================================================================
// Farm profile (farm_details additions)
// =====================================================================

export interface FarmProfile {
  imageUrl: string | null;
  address: string | null;
  capacity: number | null;
  establishedOn: string | null;
  farmCategory: FarmCategory | null;
}

export const emptyFarmProfile: FarmProfile = {
  imageUrl: null,
  address: null,
  capacity: null,
  establishedOn: null,
  farmCategory: null,
};

export interface FarmProfileRow {
  organization_id: string;
  image_key: string | null;
  image_provider: string | null;
  address: string | null;
  capacity: number | string | null;
  established_on: string | Date | null;
  farm_category: string | null;
  join_code: string;
}

export interface UpdateFarmProfileInput {
  address?: string | null;
  capacity?: number | null;
  establishedOn?: string | null;
  farmCategory?: FarmCategory | null;
}

// =====================================================================
// Poultry daily records
// =====================================================================

export interface PoultryDailyRecord {
  id: string;
  poultryFlockId: string;
  organizationId: string;
  recordDate: string;
  feedKg: string;
  waterLiters: string;
  appetite: PoultryAppetite | null;
  activity: PoultryActivity | null;
  mortalityCount: number;
  mortalityCause: string | null;
  treatment: string | null;
  expenseAmount: string;
  averageWeightGrams: string | null;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoultryDailyRecordRow {
  id: string;
  poultry_flock_id: string;
  organization_id: string;
  record_date: string | Date;
  feed_kg: string | number;
  water_liters: string | number;
  appetite: string | null;
  activity: string | null;
  mortality_count: number | string;
  mortality_cause: string | null;
  treatment: string | null;
  expense_amount: string | number;
  average_weight_grams: string | number | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToDailyRecord(r: PoultryDailyRecordRow): PoultryDailyRecord {
  return {
    id: r.id,
    poultryFlockId: r.poultry_flock_id,
    organizationId: r.organization_id,
    recordDate: dateOnly(r.record_date) as string,
    feedKg: String(r.feed_kg),
    waterLiters: String(r.water_liters),
    appetite: (r.appetite as PoultryAppetite | null) ?? null,
    activity: (r.activity as PoultryActivity | null) ?? null,
    mortalityCount: Number(r.mortality_count),
    mortalityCause: r.mortality_cause,
    treatment: r.treatment,
    expenseAmount: String(r.expense_amount),
    averageWeightGrams: num(r.average_weight_grams),
    notes: r.notes,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreateDailyRecordInput {
  recordDate: string;
  feedKg?: number;
  waterLiters?: number;
  appetite?: PoultryAppetite | null;
  activity?: PoultryActivity | null;
  mortalityCount?: number;
  mortalityCause?: string | null;
  treatment?: string | null;
  expenseAmount?: number;
  averageWeightGrams?: number | null;
  notes?: string | null;
}

export type UpdateDailyRecordInput = Partial<Omit<CreateDailyRecordInput, 'recordDate'>>;

export interface ListDailyRecordsFilter {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
}

// =====================================================================
// Batch summary + weekly summary (server-computed)
// =====================================================================

/** The "الدفعة رقم N" card on the Farm Details screen. Every figure is derived. */
export interface BatchSummary {
  flockId: string;
  batchNumber: number | null;
  status: string;
  birdType: string;
  name: string;
  arrivalDate: string;
  initialBirdCount: number;
  /** initialBirdCount − Σ mortality (daily records). Never below 0. */
  currentBirdCount: number;
  totalMortality: number;
  /** Whole days since arrival. */
  ageDays: number;
  /** e.g. "1 شهر" is formatted client-side; server sends the parts. */
  ageWeeks: number;
  ageMonths: number;
  averageWeightGrams: string | null;
  targetPricePerKg: string | null;
  expectedSaleDate: string | null;
  totalExpenses: number;
  /**
   * `(currentBirdCount × avgWeightKg × targetPricePerKg) − totalExpenses`,
   * rounded to 2dp. `null` when `targetPricePerKg` or `averageWeightGrams`
   * is not set — the app shows a dash, never a fabricated number.
   */
  estimatedProfit: number | null;
  recordsCount: number;
}

/** The "ملخص الأسبوع" card. All values computed from the week's daily records. */
export interface WeeklySummary {
  flockId: string;
  weekStart: string;
  weekEnd: string;
  recordsCount: number;
  averageMortality: number;
  averageFeedKg: number;
  averageWaterLiters: number;
  totalMortality: number;
  totalFeedKg: number;
  totalWaterLiters: number;
  totalExpenses: number;
  /** last recorded weight in the week − first recorded weight in the week. */
  weightChangeGrams: number | null;
}

// =====================================================================
// Farm expenses
// =====================================================================

export interface FarmExpense {
  id: string;
  organizationId: string;
  poultryFlockId: string | null;
  category: FarmExpenseCategory;
  amount: string;
  description: string | null;
  spentOn: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FarmExpenseRow {
  id: string;
  organization_id: string;
  poultry_flock_id: string | null;
  category: string;
  amount: string | number;
  description: string | null;
  spent_on: string | Date;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToFarmExpense(r: FarmExpenseRow): FarmExpense {
  return {
    id: r.id,
    organizationId: r.organization_id,
    poultryFlockId: r.poultry_flock_id,
    category: r.category as FarmExpenseCategory,
    amount: String(r.amount),
    description: r.description,
    spentOn: dateOnly(r.spent_on) as string,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreateFarmExpenseInput {
  category: FarmExpenseCategory;
  amount: number;
  description?: string | null;
  spentOn: string;
  poultryFlockId?: string | null;
}

export type UpdateFarmExpenseInput = Partial<CreateFarmExpenseInput>;

export interface ListFarmExpensesFilter {
  page: number;
  pageSize: number;
  category?: FarmExpenseCategory;
  poultryFlockId?: string;
  from?: string;
  to?: string;
}

/** The three cards at the top of the "المصاريف" screen. */
export interface FarmExpenseSummary {
  totalThisWeek: number;
  totalThisMonth: number;
  dailyAverageThisMonth: number;
}

// =====================================================================
// Poultry health events (treatments & vaccinations)
// =====================================================================

export interface PoultryHealthEvent {
  id: string;
  poultryFlockId: string;
  organizationId: string;
  kind: PoultryHealthEventKind;
  name: string;
  medication: string | null;
  dose: string | null;
  eventDate: string;
  casesCount: number | null;
  coverageCount: number | null;
  nextDueDate: string | null;
  status: PoultryHealthEventStatus;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoultryHealthEventRow {
  id: string;
  poultry_flock_id: string;
  organization_id: string;
  kind: string;
  name: string;
  medication: string | null;
  dose: string | null;
  event_date: string | Date;
  cases_count: number | string | null;
  coverage_count: number | string | null;
  next_due_date: string | Date | null;
  status: string;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToHealthEvent(r: PoultryHealthEventRow): PoultryHealthEvent {
  return {
    id: r.id,
    poultryFlockId: r.poultry_flock_id,
    organizationId: r.organization_id,
    kind: r.kind as PoultryHealthEventKind,
    name: r.name,
    medication: r.medication,
    dose: r.dose,
    eventDate: dateOnly(r.event_date) as string,
    casesCount: r.cases_count === null ? null : Number(r.cases_count),
    coverageCount: r.coverage_count === null ? null : Number(r.coverage_count),
    nextDueDate: dateOnly(r.next_due_date),
    status: r.status as PoultryHealthEventStatus,
    notes: r.notes,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreateHealthEventInput {
  kind: PoultryHealthEventKind;
  name: string;
  medication?: string | null;
  dose?: string | null;
  eventDate: string;
  casesCount?: number | null;
  coverageCount?: number | null;
  nextDueDate?: string | null;
  status?: PoultryHealthEventStatus;
  notes?: string | null;
}

export type UpdateHealthEventInput = Partial<CreateHealthEventInput>;

export interface ListHealthEventsFilter {
  page: number;
  pageSize: number;
  kind?: PoultryHealthEventKind;
  status?: PoultryHealthEventStatus;
}

// =====================================================================
// Farm appointments
// =====================================================================

export interface FarmAppointment {
  id: string;
  organizationId: string;
  poultryFlockId: string | null;
  title: string;
  description: string | null;
  category: FarmAppointmentCategory;
  scheduledFor: string;
  status: FarmAppointmentStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FarmAppointmentRow {
  id: string;
  organization_id: string;
  poultry_flock_id: string | null;
  title: string;
  description: string | null;
  category: string;
  scheduled_for: string | Date;
  status: string;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToAppointment(r: FarmAppointmentRow): FarmAppointment {
  return {
    id: r.id,
    organizationId: r.organization_id,
    poultryFlockId: r.poultry_flock_id,
    title: r.title,
    description: r.description,
    category: r.category as FarmAppointmentCategory,
    scheduledFor: dateOnly(r.scheduled_for) as string,
    status: r.status as FarmAppointmentStatus,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreateAppointmentInput {
  title: string;
  description?: string | null;
  category?: FarmAppointmentCategory;
  scheduledFor: string;
  poultryFlockId?: string | null;
}

export type UpdateAppointmentInput = Partial<CreateAppointmentInput> & {
  status?: FarmAppointmentStatus;
};

export interface ListAppointmentsFilter {
  page: number;
  pageSize: number;
  category?: FarmAppointmentCategory;
  status?: FarmAppointmentStatus;
  from?: string;
}

// =====================================================================
// Poultry individual cases
// =====================================================================

export interface PoultryCase {
  id: string;
  poultryFlockId: string;
  organizationId: string;
  caseNumber: number | null;
  animalTag: string | null;
  sex: PoultryCaseSex;
  diagnosis: string | null;
  treatment: string | null;
  status: PoultryCaseStatus;
  startedOn: string;
  nextFollowupOn: string | null;
  imageUrl: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoultryCaseRow {
  id: string;
  poultry_flock_id: string;
  organization_id: string;
  case_number: number | string | null;
  animal_tag: string | null;
  sex: string;
  diagnosis: string | null;
  treatment: string | null;
  status: string;
  started_on: string | Date;
  next_followup_on: string | Date | null;
  image_key: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToCase(r: PoultryCaseRow, imageUrl: string | null): PoultryCase {
  return {
    id: r.id,
    poultryFlockId: r.poultry_flock_id,
    organizationId: r.organization_id,
    caseNumber: r.case_number === null ? null : Number(r.case_number),
    animalTag: r.animal_tag,
    sex: r.sex as PoultryCaseSex,
    diagnosis: r.diagnosis,
    treatment: r.treatment,
    status: r.status as PoultryCaseStatus,
    startedOn: dateOnly(r.started_on) as string,
    nextFollowupOn: dateOnly(r.next_followup_on),
    imageUrl,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreatePoultryCaseInput {
  animalTag?: string | null;
  sex?: PoultryCaseSex;
  diagnosis?: string | null;
  treatment?: string | null;
  startedOn: string;
  nextFollowupOn?: string | null;
}

export type UpdatePoultryCaseInput = Partial<CreatePoultryCaseInput> & {
  status?: PoultryCaseStatus;
};

export interface ListPoultryCasesFilter {
  page: number;
  pageSize: number;
  status?: PoultryCaseStatus;
}

/** The stat chips at the top of the "الحالات الفردية" screen. */
export interface PoultryCaseSummary {
  deceased: number;
  recovered: number;
  underTreatment: number;
}
