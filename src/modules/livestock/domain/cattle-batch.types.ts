import type { CattleBatchStatus } from './cattle-batch.constants.js';

// --- internal aggregate ----------------------------------------------

export interface CattleBatch {
  id: string;
  organizationId: string;
  name: string;
  breed: string | null;
  headCount: number;
  calfCount: number | null;
  bullCount: number | null;
  cowCount: number | null;
  arrivalDate: string;
  status: CattleBatchStatus;
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

export type CattleBatchDTO = CattleBatch;

// --- input shapes ------------------------------------------------

export interface CreateCattleBatchInput {
  name: string;
  breed?: string | null;
  headCount: number;
  calfCount?: number | null;
  bullCount?: number | null;
  cowCount?: number | null;
  arrivalDate: string;
  notes?: string | null;
  initialHeadCount?: number | null;
  averageWeightKg?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export interface UpdateCattleBatchInput {
  name?: string;
  breed?: string | null;
  headCount?: number;
  calfCount?: number | null;
  bullCount?: number | null;
  cowCount?: number | null;
  arrivalDate?: string;
  status?: CattleBatchStatus;
  notes?: string | null;
  initialHeadCount?: number | null;
  averageWeightKg?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export interface ListCattleBatchesFilter {
  page: number;
  pageSize: number;
  status?: CattleBatchStatus;
}

// --- row ---------------------------------------------------------

export interface CattleBatchRow {
  id: string;
  organization_id: string;
  organization_type: string;
  name: string;
  breed: string | null;
  head_count: number | string;
  calf_count: number | string | null;
  bull_count: number | string | null;
  cow_count: number | string | null;
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

export function rowToCattleBatch(row: CattleBatchRow): CattleBatch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    breed: row.breed,
    headCount: Number(row.head_count),
    calfCount: intOrNull(row.calf_count),
    bullCount: intOrNull(row.bull_count),
    cowCount: intOrNull(row.cow_count),
    arrivalDate: dateOnly(row.arrival_date) as string,
    status: row.status as CattleBatchStatus,
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

export function toCattleBatchDTO(batch: CattleBatch): CattleBatchDTO {
  return { ...batch };
}
