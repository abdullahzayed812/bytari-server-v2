import type { SheepBatchStatus } from './sheep-batch.constants.js';

// --- internal aggregate ----------------------------------------------

export interface SheepBatch {
  id: string;
  organizationId: string;
  name: string;
  breed: string | null;
  headCount: number;
  lambCount: number | null;
  maleCount: number | null;
  femaleCount: number | null;
  arrivalDate: string;
  status: SheepBatchStatus;
  notes: string | null;
  /** Per-farm sequential batch number ("الدفعة رقم N"). */
  batchNumber: number | null;
  /** Head count placed at the start of the batch — the denominator for mortality. */
  initialHeadCount: number | null;
  /** Latest recorded average weight, kg. `numeric` → string. */
  averageWeightKg: string | null;
  /** Optional planned sale price, used for the profit estimate. `numeric` → string. */
  targetPricePerKg: string | null;
  expectedSaleDate: string | null;
  createdByUserId: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SheepBatchDTO = SheepBatch;

// --- input shapes ------------------------------------------------

export interface CreateSheepBatchInput {
  name: string;
  breed?: string | null;
  headCount: number;
  lambCount?: number | null;
  maleCount?: number | null;
  femaleCount?: number | null;
  arrivalDate: string;
  notes?: string | null;
  initialHeadCount?: number | null;
  averageWeightKg?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export interface UpdateSheepBatchInput {
  name?: string;
  breed?: string | null;
  headCount?: number;
  lambCount?: number | null;
  maleCount?: number | null;
  femaleCount?: number | null;
  arrivalDate?: string;
  status?: SheepBatchStatus;
  notes?: string | null;
  initialHeadCount?: number | null;
  averageWeightKg?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export interface ListSheepBatchesFilter {
  page: number;
  pageSize: number;
  status?: SheepBatchStatus;
}

// --- row ---------------------------------------------------------

export interface SheepBatchRow {
  id: string;
  organization_id: string;
  organization_type: string;
  name: string;
  breed: string | null;
  head_count: number | string;
  lamb_count: number | string | null;
  male_count: number | string | null;
  female_count: number | string | null;
  arrival_date: string | Date;
  status: string;
  notes: string | null;
  batch_number: number | string | null;
  initial_head_count: number | string | null;
  average_weight_kg: number | string | null;
  target_price_per_kg: number | string | null;
  expected_sale_date: string | Date | null;
  created_by_user_id: string | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function intOrNull(v: number | string | null): number | null {
  return v === null ? null : Number(v);
}

export function rowToSheepBatch(row: SheepBatchRow): SheepBatch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    breed: row.breed,
    headCount: Number(row.head_count),
    lambCount: intOrNull(row.lamb_count),
    maleCount: intOrNull(row.male_count),
    femaleCount: intOrNull(row.female_count),
    arrivalDate: dateOnly(row.arrival_date) as string,
    status: row.status as SheepBatchStatus,
    notes: row.notes,
    batchNumber: intOrNull(row.batch_number),
    initialHeadCount: intOrNull(row.initial_head_count),
    averageWeightKg: row.average_weight_kg === null ? null : String(row.average_weight_kg),
    targetPricePerKg: row.target_price_per_kg === null ? null : String(row.target_price_per_kg),
    expectedSaleDate: dateOnly(row.expected_sale_date),
    createdByUserId: row.created_by_user_id,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toSheepBatchDTO(batch: SheepBatch): SheepBatchDTO {
  return { ...batch };
}
