import type { AnimalSpecies } from './animal.constants.js';
import type { PublicationKind, PublicationStatus } from './publication.constants.js';

// --- internal aggregate ------------------------------------------------

export interface AnimalPublication {
  id: string;
  animalId: string;
  kind: PublicationKind;
  status: PublicationStatus;
  note: string | null;
  createdByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A publication row joined with a small, non-PII animal summary. */
export interface AnimalPublicationWithAnimal extends AnimalPublication {
  animal: { id: string; name: string; species: AnimalSpecies; breed: string | null };
}

// --- API DTOs -------------------------------------------------------

/** Full moderation / owner view. */
export interface AnimalPublicationDTO {
  id: string;
  animalId: string;
  kind: PublicationKind;
  status: PublicationStatus;
  note: string | null;
  createdByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public-browse projection — APPROVED publications only. Deliberately omits the
 * publisher's identity, all moderation metadata, and status (always APPROVED).
 */
export interface PublicPublicationDTO {
  id: string;
  kind: PublicationKind;
  note: string | null;
  publishedAt: string;
  animal: { id: string; name: string; species: AnimalSpecies; breed: string | null };
}

// --- input / filter shapes -------------------------------------

export interface CreatePublicationInput {
  kind: PublicationKind;
  note?: string | null;
}

export interface ListPublicationsFilter {
  page: number;
  pageSize: number;
  kind?: PublicationKind;
  status?: PublicationStatus;
}

export interface PublicListFilter {
  page: number;
  pageSize: number;
  kind?: PublicationKind;
}

// --- row ---------------------------------------------------------

export interface AnimalPublicationRow {
  id: string;
  animal_id: string;
  kind: string;
  status: string;
  note: string | null;
  created_by_user_id: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToPublication(row: AnimalPublicationRow): AnimalPublication {
  return {
    id: row.id,
    animalId: row.animal_id,
    kind: row.kind as PublicationKind,
    status: row.status as PublicationStatus,
    note: row.note,
    createdByUserId: row.created_by_user_id,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toPublicationDTO(p: AnimalPublication): AnimalPublicationDTO {
  return { ...p };
}

export function toPublicPublicationDTO(p: AnimalPublicationWithAnimal): PublicPublicationDTO {
  return {
    id: p.id,
    kind: p.kind,
    note: p.note,
    publishedAt: p.reviewedAt ?? p.createdAt,
    animal: p.animal,
  };
}
