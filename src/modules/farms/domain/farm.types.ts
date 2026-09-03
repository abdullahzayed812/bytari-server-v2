import type { PoultryBirdType, PoultryFlockStatus } from './farm.constants.js';

// --- internal aggregate ----------------------------------------------

export interface PoultryFlock {
  id: string;
  organizationId: string;
  name: string;
  birdType: PoultryBirdType;
  birdCount: number;
  arrivalDate: string;
  status: PoultryFlockStatus;
  notes: string | null;
  /** Per-farm sequential batch number ("الدفعة رقم N"). */
  batchNumber: number | null;
  /** Birds placed at the start of the batch — the denominator for mortality. */
  initialBirdCount: number | null;
  /** Latest recorded average bird weight, grams. `numeric` → string. */
  averageWeightGrams: string | null;
  /** Optional planned sale price, used for the profit estimate. `numeric` → string. */
  targetPricePerKg: string | null;
  expectedSaleDate: string | null;
  createdByUserId: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- API DTO -------------------------------------------------------

export type PoultryFlockDTO = PoultryFlock;

// --- input shapes ------------------------------------------------

export interface CreatePoultryFlockInput {
  name: string;
  birdType: PoultryBirdType;
  birdCount: number;
  arrivalDate: string;
  notes?: string | null;
  initialBirdCount?: number | null;
  averageWeightGrams?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export interface UpdatePoultryFlockInput {
  name?: string;
  birdType?: PoultryBirdType;
  birdCount?: number;
  arrivalDate?: string;
  status?: PoultryFlockStatus;
  notes?: string | null;
  initialBirdCount?: number | null;
  averageWeightGrams?: number | null;
  targetPricePerKg?: number | null;
  expectedSaleDate?: string | null;
}

export interface ListPoultryFlocksFilter {
  page: number;
  pageSize: number;
  status?: PoultryFlockStatus;
  birdType?: PoultryBirdType;
}

// --- row ---------------------------------------------------------

export interface PoultryFlockRow {
  id: string;
  organization_id: string;
  organization_type: string;
  name: string;
  bird_type: string;
  bird_count: number | string;
  arrival_date: string | Date;
  status: string;
  notes: string | null;
  batch_number: number | string | null;
  initial_bird_count: number | string | null;
  average_weight_grams: number | string | null;
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

export function rowToPoultryFlock(row: PoultryFlockRow): PoultryFlock {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    birdType: row.bird_type as PoultryBirdType,
    birdCount: Number(row.bird_count),
    arrivalDate: dateOnly(row.arrival_date) as string,
    status: row.status as PoultryFlockStatus,
    notes: row.notes,
    batchNumber: row.batch_number === null ? null : Number(row.batch_number),
    initialBirdCount: row.initial_bird_count === null ? null : Number(row.initial_bird_count),
    averageWeightGrams: row.average_weight_grams === null ? null : String(row.average_weight_grams),
    targetPricePerKg: row.target_price_per_kg === null ? null : String(row.target_price_per_kg),
    expectedSaleDate: dateOnly(row.expected_sale_date),
    createdByUserId: row.created_by_user_id,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toPoultryFlockDTO(flock: PoultryFlock): PoultryFlockDTO {
  return { ...flock };
}
