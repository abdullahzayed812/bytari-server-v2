import type {
  LivestockActivity,
  LivestockAppetite,
  LivestockCaseSex,
  LivestockCaseStatus,
  LivestockFeedType,
  LivestockHealthEventKind,
  LivestockHealthEventStatus,
} from './livestock-ops.constants.js';

/**
 * Cattle Farm operations DTOs + row mappers — mirrors
 * `server/src/modules/farms/domain/poultry-ops.types.ts`'s daily-record/
 * health-event/case/summary shapes exactly, plus the two screenshot-confirmed
 * additions on the daily record (`sickCasesCount`, `feedType`). Same
 * convention: `numeric` columns surface as strings, integers as numbers,
 * dates as `YYYY-MM-DD`.
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
// Cattle daily records
// =====================================================================

export interface CattleDailyRecord {
  id: string;
  cattleBatchId: string;
  organizationId: string;
  recordDate: string;
  feedKg: string;
  waterLiters: string;
  appetite: LivestockAppetite | null;
  activity: LivestockActivity | null;
  mortalityCount: number;
  mortalityCause: string | null;
  sickCasesCount: number;
  feedType: LivestockFeedType | null;
  treatment: string | null;
  expenseAmount: string;
  averageWeightKg: string | null;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CattleDailyRecordRow {
  id: string;
  cattle_batch_id: string;
  organization_id: string;
  record_date: string | Date;
  feed_kg: string | number;
  water_liters: string | number;
  appetite: string | null;
  activity: string | null;
  mortality_count: number | string;
  mortality_cause: string | null;
  sick_cases_count: number | string;
  feed_type: string | null;
  treatment: string | null;
  expense_amount: string | number;
  average_weight_kg: string | number | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToCattleDailyRecord(r: CattleDailyRecordRow): CattleDailyRecord {
  return {
    id: r.id,
    cattleBatchId: r.cattle_batch_id,
    organizationId: r.organization_id,
    recordDate: dateOnly(r.record_date) as string,
    feedKg: String(r.feed_kg),
    waterLiters: String(r.water_liters),
    appetite: (r.appetite as LivestockAppetite | null) ?? null,
    activity: (r.activity as LivestockActivity | null) ?? null,
    mortalityCount: Number(r.mortality_count),
    mortalityCause: r.mortality_cause,
    sickCasesCount: Number(r.sick_cases_count),
    feedType: (r.feed_type as LivestockFeedType | null) ?? null,
    treatment: r.treatment,
    expenseAmount: String(r.expense_amount),
    averageWeightKg: num(r.average_weight_kg),
    notes: r.notes,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreateCattleDailyRecordInput {
  recordDate: string;
  feedKg?: number;
  waterLiters?: number;
  appetite?: LivestockAppetite | null;
  activity?: LivestockActivity | null;
  mortalityCount?: number;
  mortalityCause?: string | null;
  sickCasesCount?: number;
  feedType?: LivestockFeedType | null;
  treatment?: string | null;
  expenseAmount?: number;
  averageWeightKg?: number | null;
  notes?: string | null;
}

export type UpdateCattleDailyRecordInput = Partial<Omit<CreateCattleDailyRecordInput, 'recordDate'>>;

export interface ListCattleDailyRecordsFilter {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
}

// =====================================================================
// Batch summary + weekly summary (server-computed)
// =====================================================================

export interface CattleBatchSummary {
  batchId: string;
  batchNumber: number | null;
  status: string;
  breed: string | null;
  name: string;
  arrivalDate: string;
  initialHeadCount: number;
  currentHeadCount: number;
  totalMortality: number;
  ageDays: number;
  ageWeeks: number;
  ageMonths: number;
  averageWeightKg: string | null;
  targetPricePerKg: string | null;
  expectedSaleDate: string | null;
  totalExpenses: number;
  estimatedProfit: number | null;
  recordsCount: number;
}

export interface CattleWeeklySummary {
  batchId: string;
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
  weightChangeKg: number | null;
}

// =====================================================================
// Cattle health events (treatments & vaccinations)
// =====================================================================

export interface CattleHealthEvent {
  id: string;
  cattleBatchId: string;
  organizationId: string;
  kind: LivestockHealthEventKind;
  name: string;
  medication: string | null;
  dose: string | null;
  eventDate: string;
  casesCount: number | null;
  coverageCount: number | null;
  nextDueDate: string | null;
  status: LivestockHealthEventStatus;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CattleHealthEventRow {
  id: string;
  cattle_batch_id: string;
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

export function rowToCattleHealthEvent(r: CattleHealthEventRow): CattleHealthEvent {
  return {
    id: r.id,
    cattleBatchId: r.cattle_batch_id,
    organizationId: r.organization_id,
    kind: r.kind as LivestockHealthEventKind,
    name: r.name,
    medication: r.medication,
    dose: r.dose,
    eventDate: dateOnly(r.event_date) as string,
    casesCount: r.cases_count === null ? null : Number(r.cases_count),
    coverageCount: r.coverage_count === null ? null : Number(r.coverage_count),
    nextDueDate: dateOnly(r.next_due_date),
    status: r.status as LivestockHealthEventStatus,
    notes: r.notes,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreateCattleHealthEventInput {
  kind: LivestockHealthEventKind;
  name: string;
  medication?: string | null;
  dose?: string | null;
  eventDate: string;
  casesCount?: number | null;
  coverageCount?: number | null;
  nextDueDate?: string | null;
  status?: LivestockHealthEventStatus;
  notes?: string | null;
}

export type UpdateCattleHealthEventInput = Partial<CreateCattleHealthEventInput>;

export interface ListCattleHealthEventsFilter {
  page: number;
  pageSize: number;
  kind?: LivestockHealthEventKind;
  status?: LivestockHealthEventStatus;
}

// =====================================================================
// Cattle individual cases
// =====================================================================

export interface CattleCase {
  id: string;
  cattleBatchId: string;
  organizationId: string;
  caseNumber: number | null;
  animalTag: string | null;
  sex: LivestockCaseSex;
  diagnosis: string | null;
  treatment: string | null;
  status: LivestockCaseStatus;
  startedOn: string;
  nextFollowupOn: string | null;
  imageUrl: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CattleCaseRow {
  id: string;
  cattle_batch_id: string;
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

export function rowToCattleCase(r: CattleCaseRow, imageUrl: string | null): CattleCase {
  return {
    id: r.id,
    cattleBatchId: r.cattle_batch_id,
    organizationId: r.organization_id,
    caseNumber: r.case_number === null ? null : Number(r.case_number),
    animalTag: r.animal_tag,
    sex: r.sex as LivestockCaseSex,
    diagnosis: r.diagnosis,
    treatment: r.treatment,
    status: r.status as LivestockCaseStatus,
    startedOn: dateOnly(r.started_on) as string,
    nextFollowupOn: dateOnly(r.next_followup_on),
    imageUrl,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface CreateCattleCaseInput {
  animalTag?: string | null;
  sex?: LivestockCaseSex;
  diagnosis?: string | null;
  treatment?: string | null;
  startedOn: string;
  nextFollowupOn?: string | null;
}

export type UpdateCattleCaseInput = Partial<CreateCattleCaseInput> & {
  status?: LivestockCaseStatus;
};

export interface ListCattleCasesFilter {
  page: number;
  pageSize: number;
  status?: LivestockCaseStatus;
}

export interface CattleCaseSummary {
  deceased: number;
  recovered: number;
  underTreatment: number;
}
