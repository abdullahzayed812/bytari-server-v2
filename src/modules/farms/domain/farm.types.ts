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
  createdByUserId: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- API DTO -------------------------------------------------------

export interface PoultryFlockDTO {
  id: string;
  organizationId: string;
  name: string;
  birdType: PoultryBirdType;
  birdCount: number;
  arrivalDate: string;
  status: PoultryFlockStatus;
  notes: string | null;
  createdByUserId: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- input shapes ------------------------------------------------

export interface CreatePoultryFlockInput {
  name: string;
  birdType: PoultryBirdType;
  birdCount: number;
  arrivalDate: string;
  notes?: string | null;
}

export interface UpdatePoultryFlockInput {
  name?: string;
  birdType?: PoultryBirdType;
  birdCount?: number;
  arrivalDate?: string;
  status?: PoultryFlockStatus;
  notes?: string | null;
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
    createdByUserId: row.created_by_user_id,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toPoultryFlockDTO(flock: PoultryFlock): PoultryFlockDTO {
  return { ...flock };
}
