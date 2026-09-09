import type {
  VetServiceAnimalType,
  VetServiceEngagementStatus,
  VetServiceLocationMode,
  VetServiceModerationStatus,
  VetServicePriceType,
  VetServiceType,
  VetServiceUrgency,
} from './vet-service.constants.js';

// ==================================================================
//  Service listings (vet-created, moderated)
// ==================================================================

export interface VetServiceListing {
  id: string;
  veterinarianUserId: string;
  title: string;
  description: string;
  serviceType: VetServiceType;
  animalType: VetServiceAnimalType;
  specialty: string | null;
  governorate: string;
  district: string | null;
  priceAmount: string | null;
  priceType: VetServicePriceType;
  locationMode: VetServiceLocationMode;
  availability: string | null;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  executionDuration: string | null;
  arrivalTime: string | null;
  details: string[];
  imageKeys: string[];
  status: VetServiceModerationStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VetServiceUserSummary {
  id: string;
  firstName: string;
  lastName: string;
}

/** Client-safe listing shape (moderation metadata included — owner / admin view). */
export interface VetServiceListingDTO
  extends Omit<VetServiceListing, 'imageKeys'> {
  veterinarian: VetServiceUserSummary;
  imageUrls: string[];
}

/** Public browse projection — APPROVED, not closed. No moderation metadata. */
export interface PublicVetServiceListingDTO {
  id: string;
  title: string;
  description: string;
  serviceType: VetServiceType;
  animalType: VetServiceAnimalType;
  specialty: string | null;
  governorate: string;
  district: string | null;
  priceAmount: string | null;
  priceType: VetServicePriceType;
  locationMode: VetServiceLocationMode;
  availability: string | null;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  executionDuration: string | null;
  arrivalTime: string | null;
  details: string[];
  imageUrls: string[];
  veterinarian: VetServiceUserSummary;
  publishedAt: string;
}

// ==================================================================
//  Service requests (pet-owner-created, moderated, standalone)
// ==================================================================

export interface VetServiceRequest {
  id: string;
  requestNumber: string;
  petOwnerUserId: string;
  title: string;
  description: string;
  animalType: VetServiceAnimalType;
  serviceType: VetServiceType;
  animalCount: number | null;
  animalAge: string | null;
  governorate: string;
  district: string | null;
  detailedAddress: string | null;
  needsFieldVisit: boolean;
  preferredDate: string | null;
  budgetAmount: string | null;
  urgency: VetServiceUrgency;
  extraNotes: string | null;
  imageKeys: string[];
  status: VetServiceModerationStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VetServiceRequestDTO extends Omit<VetServiceRequest, 'imageKeys'> {
  petOwner: VetServiceUserSummary;
  imageUrls: string[];
  /** Number of offers submitted — visible to the request owner / moderators. */
  offerCount?: number;
}

/** Public browse projection — APPROVED, not closed. Owner identity kept minimal. */
export interface PublicVetServiceRequestDTO {
  id: string;
  requestNumber: string;
  title: string;
  description: string;
  animalType: VetServiceAnimalType;
  serviceType: VetServiceType;
  animalCount: number | null;
  animalAge: string | null;
  governorate: string;
  district: string | null;
  needsFieldVisit: boolean;
  preferredDate: string | null;
  budgetAmount: string | null;
  urgency: VetServiceUrgency;
  extraNotes: string | null;
  imageUrls: string[];
  petOwner: VetServiceUserSummary;
  publishedAt: string;
}

// ==================================================================
//  Offers (vet → request)
// ==================================================================

export interface VetServiceOffer {
  id: string;
  requestId: string;
  veterinarianUserId: string;
  proposedAmount: string | null;
  executionDate: string | null;
  expectedDuration: string | null;
  includesFieldVisit: boolean | null;
  details: string | null;
  imageKeys: string[];
  status: VetServiceEngagementStatus;
  conversationId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VetServiceOfferDTO extends Omit<VetServiceOffer, 'imageKeys'> {
  veterinarian: VetServiceUserSummary;
  imageUrls: string[];
  /** Joined request summary — for "my offers" and the request-owner's offer list. */
  request?: {
    id: string;
    requestNumber: string;
    title: string;
    animalType: VetServiceAnimalType;
    serviceType: VetServiceType;
    petOwnerUserId: string;
  };
}

// ==================================================================
//  Listing requests (pet-owner → listing)
// ==================================================================

export interface VetServiceListingRequest {
  id: string;
  requestNumber: string;
  listingId: string;
  petOwnerUserId: string;
  animalType: VetServiceAnimalType;
  animalCount: number | null;
  animalAge: string | null;
  governorate: string | null;
  district: string | null;
  needsFieldVisit: boolean;
  preferredDatetime: string | null;
  budgetAmount: string | null;
  notes: string | null;
  previousVisit: boolean | null;
  imageKeys: string[];
  status: VetServiceEngagementStatus;
  conversationId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VetServiceListingRequestDTO
  extends Omit<VetServiceListingRequest, 'imageKeys'> {
  petOwner: VetServiceUserSummary;
  imageUrls: string[];
  listing?: {
    id: string;
    title: string;
    serviceType: VetServiceType;
    animalType: VetServiceAnimalType;
    veterinarianUserId: string;
    priceAmount: string | null;
  };
}

// ==================================================================
//  Rows
// ==================================================================

export interface VetServiceListingRow {
  id: string;
  veterinarian_user_id: string;
  title: string;
  description: string;
  service_type: string;
  animal_type: string;
  specialty: string | null;
  governorate: string;
  district: string | null;
  price_amount: string | null;
  price_type: string;
  location_mode: string;
  availability: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  execution_duration: string | null;
  arrival_time: string | null;
  details: string[] | null;
  image_keys: string[] | null;
  status: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VetServiceRequestRow {
  id: string;
  request_number: string;
  pet_owner_user_id: string;
  title: string;
  description: string;
  animal_type: string;
  service_type: string;
  animal_count: number | null;
  animal_age: string | null;
  governorate: string;
  district: string | null;
  detailed_address: string | null;
  needs_field_visit: boolean;
  preferred_date: string | Date | null;
  budget_amount: string | null;
  urgency: string;
  extra_notes: string | null;
  image_keys: string[] | null;
  status: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VetServiceOfferRow {
  id: string;
  request_id: string;
  veterinarian_user_id: string;
  proposed_amount: string | null;
  execution_date: string | Date | null;
  expected_duration: string | null;
  includes_field_visit: boolean | null;
  details: string | null;
  image_keys: string[] | null;
  status: string;
  conversation_id: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VetServiceListingRequestRow {
  id: string;
  request_number: string;
  listing_id: string;
  pet_owner_user_id: string;
  animal_type: string;
  animal_count: number | null;
  animal_age: string | null;
  governorate: string | null;
  district: string | null;
  needs_field_visit: boolean;
  preferred_datetime: Date | null;
  budget_amount: string | null;
  notes: string | null;
  previous_visit: boolean | null;
  image_keys: string[] | null;
  status: string;
  conversation_id: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ==================================================================
//  Row → aggregate
// ==================================================================

function dateOnly(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10);
}

export function rowToListing(row: VetServiceListingRow): VetServiceListing {
  return {
    id: row.id,
    veterinarianUserId: row.veterinarian_user_id,
    title: row.title,
    description: row.description,
    serviceType: row.service_type as VetServiceType,
    animalType: row.animal_type as VetServiceAnimalType,
    specialty: row.specialty,
    governorate: row.governorate,
    district: row.district,
    priceAmount: row.price_amount,
    priceType: row.price_type as VetServicePriceType,
    locationMode: row.location_mode as VetServiceLocationMode,
    availability: row.availability,
    contactPhone: row.contact_phone,
    contactWhatsapp: row.contact_whatsapp,
    executionDuration: row.execution_duration,
    arrivalTime: row.arrival_time,
    details: row.details ?? [],
    imageKeys: row.image_keys ?? [],
    status: row.status as VetServiceModerationStatus,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    rejectionReason: row.rejection_reason,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToRequest(row: VetServiceRequestRow): VetServiceRequest {
  return {
    id: row.id,
    requestNumber: row.request_number,
    petOwnerUserId: row.pet_owner_user_id,
    title: row.title,
    description: row.description,
    animalType: row.animal_type as VetServiceAnimalType,
    serviceType: row.service_type as VetServiceType,
    animalCount: row.animal_count,
    animalAge: row.animal_age,
    governorate: row.governorate,
    district: row.district,
    detailedAddress: row.detailed_address,
    needsFieldVisit: row.needs_field_visit,
    preferredDate: dateOnly(row.preferred_date),
    budgetAmount: row.budget_amount,
    urgency: row.urgency as VetServiceUrgency,
    extraNotes: row.extra_notes,
    imageKeys: row.image_keys ?? [],
    status: row.status as VetServiceModerationStatus,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    rejectionReason: row.rejection_reason,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToOffer(row: VetServiceOfferRow): VetServiceOffer {
  return {
    id: row.id,
    requestId: row.request_id,
    veterinarianUserId: row.veterinarian_user_id,
    proposedAmount: row.proposed_amount,
    executionDate: dateOnly(row.execution_date),
    expectedDuration: row.expected_duration,
    includesFieldVisit: row.includes_field_visit,
    details: row.details,
    imageKeys: row.image_keys ?? [],
    status: row.status as VetServiceEngagementStatus,
    conversationId: row.conversation_id,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToListingRequest(
  row: VetServiceListingRequestRow,
): VetServiceListingRequest {
  return {
    id: row.id,
    requestNumber: row.request_number,
    listingId: row.listing_id,
    petOwnerUserId: row.pet_owner_user_id,
    animalType: row.animal_type as VetServiceAnimalType,
    animalCount: row.animal_count,
    animalAge: row.animal_age,
    governorate: row.governorate,
    district: row.district,
    needsFieldVisit: row.needs_field_visit,
    preferredDatetime: row.preferred_datetime ? row.preferred_datetime.toISOString() : null,
    budgetAmount: row.budget_amount,
    notes: row.notes,
    previousVisit: row.previous_visit,
    imageKeys: row.image_keys ?? [],
    status: row.status as VetServiceEngagementStatus,
    conversationId: row.conversation_id,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ==================================================================
//  Input / filter shapes
// ==================================================================

export interface CreateVetServiceListingInput {
  title: string;
  description: string;
  serviceType: VetServiceType;
  animalType: VetServiceAnimalType;
  specialty?: string | null;
  governorate: string;
  district?: string | null;
  priceAmount?: string | null;
  priceType?: VetServicePriceType;
  locationMode?: VetServiceLocationMode;
  availability?: string | null;
  contactPhone?: string | null;
  contactWhatsapp?: string | null;
  executionDuration?: string | null;
  arrivalTime?: string | null;
  details?: string[];
  imageKeys?: string[];
}

export interface CreateVetServiceRequestInput {
  title: string;
  description: string;
  animalType: VetServiceAnimalType;
  serviceType: VetServiceType;
  animalCount?: number | null;
  animalAge?: string | null;
  governorate: string;
  district?: string | null;
  detailedAddress?: string | null;
  needsFieldVisit?: boolean;
  preferredDate?: string | null;
  budgetAmount?: string | null;
  urgency?: VetServiceUrgency;
  extraNotes?: string | null;
  imageKeys?: string[];
}

export interface CreateVetServiceOfferInput {
  proposedAmount?: string | null;
  executionDate?: string | null;
  expectedDuration?: string | null;
  includesFieldVisit?: boolean | null;
  details?: string | null;
  imageKeys?: string[];
}

export interface CreateVetServiceListingRequestInput {
  animalType: VetServiceAnimalType;
  animalCount?: number | null;
  animalAge?: string | null;
  governorate?: string | null;
  district?: string | null;
  needsFieldVisit?: boolean;
  preferredDatetime?: string | null;
  budgetAmount?: string | null;
  notes?: string | null;
  previousVisit?: boolean | null;
  imageKeys?: string[];
}

export interface ListingBrowseFilter {
  page: number;
  pageSize: number;
  search?: string;
  serviceType?: VetServiceType;
  animalType?: VetServiceAnimalType;
  governorate?: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface RequestBrowseFilter {
  page: number;
  pageSize: number;
  search?: string;
  serviceType?: VetServiceType;
  animalType?: VetServiceAnimalType;
  governorate?: string;
  urgency?: VetServiceUrgency;
  sort?: 'recent' | 'oldest';
}

export interface MineFilter {
  page: number;
  pageSize: number;
  status?: VetServiceModerationStatus;
}

export interface ModerationFilter {
  page: number;
  pageSize: number;
  status?: VetServiceModerationStatus;
}

export interface EngagementListFilter {
  page: number;
  pageSize: number;
  status?: VetServiceEngagementStatus;
}
