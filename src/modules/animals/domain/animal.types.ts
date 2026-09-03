import type {
  AnimalAgeEstimate,
  AnimalSex,
  AnimalSpecies,
  AnimalStatus,
} from './animal.constants.js';

/** Full animal aggregate (internal). Never returned raw from a controller. */
export interface Animal {
  id: string;
  name: string;
  species: AnimalSpecies;
  breed: string | null;
  sex: AnimalSex;
  dateOfBirth: string | null;
  notes: string | null;
  status: AnimalStatus;
  createdBy: string;
  deactivatedAt: string | null;
  color: string | null;
  distinguishingFeatures: string | null;
  ageEstimate: AnimalAgeEstimate | null;
  /** R2 storage keys — resolved to URLs by the service layer, same as organization galleries. */
  galleryKeys: string[];
  createdAt: string;
  updatedAt: string;
}

/** One ownership interval for an animal. */
export interface AnimalOwnership {
  id: string;
  animalId: string;
  ownerUserId: string;
  startedAt: string;
  endedAt: string | null;
  transferredBy: string | null;
  transferReason: string | null;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

// --- API DTOs -------------------------------------------------------

/** Client-safe animal shape. Includes the resolved current owner id. */
export interface AnimalDTO {
  id: string;
  name: string;
  species: AnimalSpecies;
  breed: string | null;
  sex: AnimalSex;
  dateOfBirth: string | null;
  notes: string | null;
  status: AnimalStatus;
  createdBy: string;
  currentOwnerUserId: string | null;
  color: string | null;
  distinguishingFeatures: string | null;
  ageEstimate: AnimalAgeEstimate | null;
  /** Resolved gallery photo URLs — R2 keys never leave the repository layer. */
  galleryUrls: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OwnershipRecordDTO {
  id: string;
  animalId: string;
  ownerUserId: string;
  owner: UserSummary | null;
  startedAt: string;
  endedAt: string | null;
  isCurrent: boolean;
  transferredBy: string | null;
  transferReason: string | null;
}

// --- input shapes -------------------------------------------------

export interface CreateAnimalInput {
  name: string;
  species: AnimalSpecies;
  breed?: string | null;
  sex?: AnimalSex;
  dateOfBirth?: string | null;
  notes?: string | null;
  color?: string | null;
  distinguishingFeatures?: string | null;
  ageEstimate?: AnimalAgeEstimate | null;
}

export interface UpdateAnimalInput {
  name?: string;
  species?: AnimalSpecies;
  breed?: string | null;
  sex?: AnimalSex;
  dateOfBirth?: string | null;
  notes?: string | null;
  color?: string | null;
  distinguishingFeatures?: string | null;
  ageEstimate?: AnimalAgeEstimate | null;
}

export interface ListAnimalsFilter {
  page: number;
  pageSize: number;
  status?: AnimalStatus;
  species?: AnimalSpecies;
  search?: string;
}

// --- rows -------------------------------------------------------

export interface AnimalRow {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string;
  date_of_birth: string | Date | null;
  notes: string | null;
  status: string;
  created_by: string;
  deactivated_at: Date | null;
  color: string | null;
  distinguishing_features: string | null;
  age_estimate: string | null;
  gallery_keys: string[] | null;
  created_at: Date;
  updated_at: Date;
}

export interface AnimalOwnershipRow {
  id: string;
  animal_id: string;
  owner_user_id: string;
  started_at: Date;
  ended_at: Date | null;
  transferred_by: string | null;
  transfer_reason: string | null;
  created_at: Date;
}

function toDateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function rowToAnimal(row: AnimalRow): Animal {
  return {
    id: row.id,
    name: row.name,
    species: row.species as AnimalSpecies,
    breed: row.breed,
    sex: row.sex as AnimalSex,
    dateOfBirth: toDateOnly(row.date_of_birth),
    notes: row.notes,
    status: row.status as AnimalStatus,
    createdBy: row.created_by,
    deactivatedAt: row.deactivated_at ? row.deactivated_at.toISOString() : null,
    color: row.color,
    distinguishingFeatures: row.distinguishing_features,
    ageEstimate: row.age_estimate as AnimalAgeEstimate | null,
    galleryKeys: row.gallery_keys ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToOwnership(row: AnimalOwnershipRow): AnimalOwnership {
  return {
    id: row.id,
    animalId: row.animal_id,
    ownerUserId: row.owner_user_id,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    transferredBy: row.transferred_by,
    transferReason: row.transfer_reason,
    createdAt: row.created_at.toISOString(),
  };
}

export function toAnimalDTO(
  animal: Animal,
  currentOwnerUserId: string | null,
  galleryUrls: string[] = [],
): AnimalDTO {
  return {
    id: animal.id,
    name: animal.name,
    species: animal.species,
    breed: animal.breed,
    sex: animal.sex,
    dateOfBirth: animal.dateOfBirth,
    notes: animal.notes,
    status: animal.status,
    createdBy: animal.createdBy,
    currentOwnerUserId,
    color: animal.color,
    distinguishingFeatures: animal.distinguishingFeatures,
    ageEstimate: animal.ageEstimate,
    galleryUrls,
    createdAt: animal.createdAt,
    updatedAt: animal.updatedAt,
  };
}
