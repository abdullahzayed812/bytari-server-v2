import type { AnimalAgeEstimate, AnimalSex, AnimalSpecies } from './animal.constants.js';
import type {
  HealthStatus,
  PublicationInteractionType,
  PublicationKind,
  PublicationStatus,
  VaccinationStatus,
} from './publication.constants.js';

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
  contactName: string;
  contactPhone: string;
  city: string | null;
  extraNotes: string | null;
  healthStatus: HealthStatus | null;
  vaccinationStatus: VaccinationStatus | null;
  isSterilized: boolean | null;
  lostDate: string | null;
  lostTime: string | null;
  lostGovernorate: string | null;
  lostDistrict: string | null;
  lostLocationDetail: string | null;
  healthNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The animal summary joined onto a publication — public-safe fields only. */
export interface PublicationAnimalSummary {
  id: string;
  name: string;
  species: AnimalSpecies;
  breed: string | null;
  sex: AnimalSex;
  dateOfBirth: string | null;
  color: string | null;
  distinguishingFeatures: string | null;
  ageEstimate: AnimalAgeEstimate | null;
  galleryUrls: string[];
}

/** A publication row joined with the animal summary above. `galleryKeys` — raw, resolved by the service. */
export interface AnimalPublicationWithAnimal extends AnimalPublication {
  animal: Omit<PublicationAnimalSummary, 'galleryUrls'> & { galleryKeys: string[] };
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
  contactName: string;
  contactPhone: string;
  city: string | null;
  extraNotes: string | null;
  healthStatus: HealthStatus | null;
  vaccinationStatus: VaccinationStatus | null;
  isSterilized: boolean | null;
  lostDate: string | null;
  lostTime: string | null;
  lostGovernorate: string | null;
  lostDistrict: string | null;
  lostLocationDetail: string | null;
  healthNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public-browse projection — APPROVED publications only. Omits the
 * publisher's account identity and all moderation metadata, but DOES include
 * `contactName` / `contactPhone` — explicit, purpose-collected contact info
 * the owner chose to publish with THIS listing (never the account's private
 * phone). This is the whole point of a Lost / Adoption / Mating listing.
 */
export interface PublicPublicationDTO {
  id: string;
  kind: PublicationKind;
  note: string | null;
  extraNotes: string | null;
  publishedAt: string;
  contactName: string;
  contactPhone: string;
  city: string | null;
  healthStatus: HealthStatus | null;
  vaccinationStatus: VaccinationStatus | null;
  isSterilized: boolean | null;
  lostDate: string | null;
  lostTime: string | null;
  lostGovernorate: string | null;
  lostDistrict: string | null;
  lostLocationDetail: string | null;
  healthNotes: string | null;
  animal: PublicationAnimalSummary;
}

// --- input / filter shapes -------------------------------------

export interface CreatePublicationInput {
  kind: PublicationKind;
  note?: string | null;
  extraNotes?: string | null;
  contactName: string;
  contactPhone: string;
  city?: string | null;
  healthStatus?: HealthStatus | null;
  vaccinationStatus?: VaccinationStatus | null;
  isSterilized?: boolean | null;
  lostDate?: string | null;
  lostTime?: string | null;
  lostGovernorate?: string | null;
  lostDistrict?: string | null;
  lostLocationDetail?: string | null;
  healthNotes?: string | null;
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
  species?: AnimalSpecies;
  search?: string;
}

/** "My listings" — the caller's own publications of every status. */
export interface MinePublicationsFilter {
  page: number;
  pageSize: number;
  kind?: PublicationKind;
  status?: PublicationStatus;
}

/**
 * "My listings" projection — the caller's own publication joined with the
 * animal summary, plus the moderation state the public projection omits
 * (`status` / `rejectionReason`) so the owner can see PENDING / REJECTED
 * listings and why one was rejected.
 */
export interface MyPublicationDTO extends PublicPublicationDTO {
  animalId: string;
  status: PublicationStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- interactions ("طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة") -----

export interface PublicationInteraction {
  id: string;
  publicationId: string;
  type: PublicationInteractionType;
  requesterUserId: string;
  message: string | null;
  createdAt: string;
}

export interface CreateInteractionInput {
  type: PublicationInteractionType;
  message?: string | null;
}

export interface InteractionRow {
  id: string;
  publication_id: string;
  type: string;
  requester_user_id: string;
  message: string | null;
  created_at: Date;
}

export function rowToInteraction(row: InteractionRow): PublicationInteraction {
  return {
    id: row.id,
    publicationId: row.publication_id,
    type: row.type as PublicationInteractionType,
    requesterUserId: row.requester_user_id,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  };
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
  contact_name: string;
  contact_phone: string;
  city: string | null;
  extra_notes: string | null;
  health_status: string | null;
  vaccination_status: string | null;
  is_sterilized: boolean | null;
  lost_date: string | Date | null;
  lost_time: string | null;
  lost_governorate: string | null;
  lost_district: string | null;
  lost_location_detail: string | null;
  health_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
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
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    city: row.city,
    extraNotes: row.extra_notes,
    healthStatus: row.health_status as HealthStatus | null,
    vaccinationStatus: row.vaccination_status as VaccinationStatus | null,
    isSterilized: row.is_sterilized,
    lostDate: toDateOnly(row.lost_date),
    lostTime: row.lost_time,
    lostGovernorate: row.lost_governorate,
    lostDistrict: row.lost_district,
    lostLocationDetail: row.lost_location_detail,
    healthNotes: row.health_notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toPublicationDTO(p: AnimalPublication): AnimalPublicationDTO {
  return { ...p };
}

export function toMyPublicationDTO(p: AnimalPublicationWithAnimal): MyPublicationDTO {
  return {
    ...toPublicPublicationDTO(p),
    animalId: p.animalId,
    status: p.status,
    rejectionReason: p.rejectionReason,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function toPublicPublicationDTO(p: AnimalPublicationWithAnimal): PublicPublicationDTO {
  const { galleryKeys: _galleryKeys, ...animalRest } = p.animal;
  void _galleryKeys;
  return {
    id: p.id,
    kind: p.kind,
    note: p.note,
    extraNotes: p.extraNotes,
    publishedAt: p.reviewedAt ?? p.createdAt,
    contactName: p.contactName,
    contactPhone: p.contactPhone,
    city: p.city,
    healthStatus: p.healthStatus,
    vaccinationStatus: p.vaccinationStatus,
    isSterilized: p.isSterilized,
    lostDate: p.lostDate,
    lostTime: p.lostTime,
    lostGovernorate: p.lostGovernorate,
    lostDistrict: p.lostDistrict,
    lostLocationDetail: p.lostLocationDetail,
    healthNotes: p.healthNotes,
    animal: { ...animalRest, galleryUrls: [] },
  };
}
