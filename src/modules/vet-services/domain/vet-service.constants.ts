/**
 * Veterinary Services marketplace — domain constants.
 *
 * Two moderated entities (vet-created service LISTINGS, pet-owner-created
 * service REQUESTS) sharing the reusable PENDING → APPROVED / REJECTED
 * lifecycle already used by animal publications. Two engagement entities
 * (an OFFER a vet submits on a request; a LISTING-REQUEST a pet owner submits
 * on a listing) share an ACCEPTED → COMPLETED lifecycle and, once accepted,
 * spawn a PET_OWNER_VETERINARIAN chat conversation.
 *
 * Text + CHECK enums (not catalogue tables), mirrored by the DB CHECK
 * constraints in `20260923010000_vet_services.ts` and by the Zod schemas.
 */

// --- moderation lifecycle (listings + requests) -------------------

export const VET_SERVICE_MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type VetServiceModerationStatus = (typeof VET_SERVICE_MODERATION_STATUSES)[number];

// --- engagement lifecycle (offers + listing-requests) ------------

export const VET_SERVICE_ENGAGEMENT_STATUSES = [
  'PENDING', // awaiting the counterpart's decision
  'ACCEPTED', // deal is on — a conversation exists, job in progress
  'COMPLETED', // "إنهاء الطلب" — job finished
  'REJECTED', // counterpart declined
  'CANCELLED', // withdrawn by the submitter before a decision
] as const;
export type VetServiceEngagementStatus = (typeof VET_SERVICE_ENGAGEMENT_STATUSES)[number];

export const VET_SERVICE_ENGAGEMENT_OPEN_STATUSES: readonly VetServiceEngagementStatus[] = [
  'PENDING',
  'ACCEPTED',
];

// --- controlled vocabularies ------------------------------------

/** Where the service is delivered. "داخل العيادة" / "زيارة ميدانية". */
export const VET_SERVICE_LOCATION_MODES = ['CLINIC', 'FIELD_VISIT', 'BOTH'] as const;
export type VetServiceLocationMode = (typeof VET_SERVICE_LOCATION_MODES)[number];

/** How firm the listed price is. */
export const VET_SERVICE_PRICE_TYPES = ['FIXED', 'APPROXIMATE', 'NEGOTIABLE'] as const;
export type VetServicePriceType = (typeof VET_SERVICE_PRICE_TYPES)[number];

/** Pet-owner request urgency. "عادي" / "عاجل". */
export const VET_SERVICE_URGENCIES = ['NORMAL', 'URGENT'] as const;
export type VetServiceUrgency = (typeof VET_SERVICE_URGENCIES)[number];

/**
 * Animal categories a service / request targets. Free text + CHECK — extend via
 * migration. Broad on purpose (covers pets, poultry, livestock, farms).
 */
export const VET_SERVICE_ANIMAL_TYPES = [
  'DOG',
  'CAT',
  'BIRD',
  'POULTRY',
  'SHEEP',
  'GOAT',
  'CATTLE',
  'HORSE',
  'CAMEL',
  'FISH',
  'OTHER',
] as const;
export type VetServiceAnimalType = (typeof VET_SERVICE_ANIMAL_TYPES)[number];

/**
 * Kind of veterinary work. Free text + CHECK — extend via migration. Mirrors
 * the "نوع الخدمة" chips in the reference designs.
 */
export const VET_SERVICE_TYPES = [
  'VACCINATION',
  'EXAMINATION',
  'TREATMENT',
  'SURGERY',
  'ARTIFICIAL_INSEMINATION',
  'FOLLOW_UP',
  'HOME_VISIT',
  'DIAGNOSIS',
  'CONSULTATION',
  'OTHER',
] as const;
export type VetServiceType = (typeof VET_SERVICE_TYPES)[number];

/** Max images per listing / request / offer. */
export const VET_SERVICE_MAX_IMAGES = 6;
export const VET_SERVICE_MAX_REQUEST_IMAGES = 4;
export const VET_SERVICE_MAX_OFFER_IMAGES = 4;

export const VET_SERVICE_TITLE_MAX = 120;
export const VET_SERVICE_DESCRIPTION_MAX = 2000;
export const VET_SERVICE_NOTES_MAX = 500;
export const VET_SERVICE_REASON_MAX = 500;

/** Signed-GET TTL for a resolved image URL (mirrors the pet-owner-store convention). */
export const VET_SERVICE_IMAGE_URL_TTL_SECONDS = 3600;

// --- audit + events ------------------------------------------------

export const VetServiceAuditAction = {
  LISTING_CREATED: 'VET_SERVICE_LISTING_CREATED',
  LISTING_APPROVED: 'VET_SERVICE_LISTING_APPROVED',
  LISTING_REJECTED: 'VET_SERVICE_LISTING_REJECTED',
  LISTING_DELETED: 'VET_SERVICE_LISTING_DELETED',
  LISTING_CLOSED: 'VET_SERVICE_LISTING_CLOSED',
  REQUEST_CREATED: 'VET_SERVICE_REQUEST_CREATED',
  REQUEST_APPROVED: 'VET_SERVICE_REQUEST_APPROVED',
  REQUEST_REJECTED: 'VET_SERVICE_REQUEST_REJECTED',
  REQUEST_DELETED: 'VET_SERVICE_REQUEST_DELETED',
  REQUEST_CLOSED: 'VET_SERVICE_REQUEST_CLOSED',
  OFFER_SUBMITTED: 'VET_SERVICE_OFFER_SUBMITTED',
  OFFER_ACCEPTED: 'VET_SERVICE_OFFER_ACCEPTED',
  OFFER_REJECTED: 'VET_SERVICE_OFFER_REJECTED',
  OFFER_WITHDRAWN: 'VET_SERVICE_OFFER_WITHDRAWN',
  OFFER_COMPLETED: 'VET_SERVICE_OFFER_COMPLETED',
  LISTING_REQUEST_SUBMITTED: 'VET_SERVICE_LISTING_REQUEST_SUBMITTED',
  LISTING_REQUEST_ACCEPTED: 'VET_SERVICE_LISTING_REQUEST_ACCEPTED',
  LISTING_REQUEST_REJECTED: 'VET_SERVICE_LISTING_REQUEST_REJECTED',
  LISTING_REQUEST_CANCELLED: 'VET_SERVICE_LISTING_REQUEST_CANCELLED',
  LISTING_REQUEST_COMPLETED: 'VET_SERVICE_LISTING_REQUEST_COMPLETED',
} as const;

export const VetServiceAuditEntity = {
  LISTING: 'VET_SERVICE_LISTING',
  REQUEST: 'VET_SERVICE_REQUEST',
  OFFER: 'VET_SERVICE_OFFER',
  LISTING_REQUEST: 'VET_SERVICE_LISTING_REQUEST',
} as const;

export const VetServiceEvent = {
  LISTING_SUBMITTED: 'vet_service.listing.submitted',
  LISTING_APPROVED: 'vet_service.listing.approved',
  LISTING_REJECTED: 'vet_service.listing.rejected',
  REQUEST_SUBMITTED: 'vet_service.request.submitted',
  REQUEST_APPROVED: 'vet_service.request.approved',
  REQUEST_REJECTED: 'vet_service.request.rejected',
  OFFER_RECEIVED: 'vet_service.offer.received',
  OFFER_ACCEPTED: 'vet_service.offer.accepted',
  OFFER_REJECTED: 'vet_service.offer.rejected',
  LISTING_REQUEST_RECEIVED: 'vet_service.listing_request.received',
  LISTING_REQUEST_ACCEPTED: 'vet_service.listing_request.accepted',
  LISTING_REQUEST_REJECTED: 'vet_service.listing_request.rejected',
  DEAL_COMPLETED: 'vet_service.deal.completed',
} as const;

/** Conversation subject types that link a chat to a vet-service engagement. */
export const VET_SERVICE_SUBJECT_TYPES = [
  'VET_SERVICE_OFFER',
  'VET_SERVICE_LISTING_REQUEST',
] as const;
export type VetServiceSubjectType = (typeof VET_SERVICE_SUBJECT_TYPES)[number];

/** RBAC: the "authorized specialist supervisor" domain for this marketplace. */
export const VET_SERVICE_SUPERVISOR_DOMAIN = 'VET_SERVICE';
export const VET_SERVICE_PERMISSION_KEYS = [
  'vet_service.read',
  'vet_service.approve',
  'vet_service.reject',
] as const;
