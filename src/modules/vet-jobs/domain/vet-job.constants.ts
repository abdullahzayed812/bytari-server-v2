/**
 * Veterinarian Jobs / Careers — domain constants.
 *
 * Two moderated entities (employer-posted OFFERS, veterinarian SEEKER
 * PROFILES) sharing the reusable PENDING → APPROVED / REJECTED lifecycle
 * already used by `vet-services` / animal publications. One engagement
 * entity (a veterinarian's APPLICATION against an offer) has its own
 * PENDING → ACCEPTED / REJECTED lifecycle decided by the offer's poster. On
 * ACCEPTED, a chat conversation is created by reusing the existing
 * `PET_OWNER_VETERINARIAN` conversation type (see `chat.service.ts`), pinned
 * via the `VET_JOB_APPLICATION` conversation subject type.
 *
 * Text + CHECK enums (not catalogue tables), mirrored by the DB CHECK
 * constraints in `20260929010000_vet_jobs.ts` and by the Zod schemas.
 */

// --- moderation lifecycle (offers + seeker profiles) -----------------

export const VET_JOB_MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type VetJobModerationStatus = (typeof VET_JOB_MODERATION_STATUSES)[number];

// --- application lifecycle (veterinarian → offer) --------------------

export const VET_JOB_APPLICATION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type VetJobApplicationStatus = (typeof VET_JOB_APPLICATION_STATUSES)[number];

// --- controlled vocabularies ------------------------------------------

/** Shared by job offers ("الدوام") and seeker profiles' preferences (multi-select). */
export const VET_JOB_EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'SHIFT',
  'EVENING',
  'OTHER',
] as const;
export type VetJobEmploymentType = (typeof VET_JOB_EMPLOYMENT_TYPES)[number];

export const VET_JOB_TITLE_MAX = 150;
export const VET_JOB_DESCRIPTION_MAX = 4000;
export const VET_JOB_TEXT_MAX = 500;
export const VET_JOB_LIST_ITEM_MAX = 200;
export const VET_JOB_MAX_LIST_ITEMS = 20;
export const VET_JOB_REASON_MAX = 500;

/** Max attachments (CV + photo) — one of each, so this is a per-kind cap. */
export const VET_JOB_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MiB
export const VET_JOB_ALLOWED_DOCUMENT_MIME = ['application/pdf'] as const;
export const VET_JOB_ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Signed-GET TTL for a resolved attachment URL. */
export const VET_JOB_ATTACHMENT_URL_TTL_SECONDS = 3600;

// --- audit + events -----------------------------------------------------

export const VetJobAuditAction = {
  OFFER_CREATED: 'VET_JOB_OFFER_CREATED',
  OFFER_UPDATED: 'VET_JOB_OFFER_UPDATED',
  OFFER_APPROVED: 'VET_JOB_OFFER_APPROVED',
  OFFER_REJECTED: 'VET_JOB_OFFER_REJECTED',
  OFFER_CLOSED: 'VET_JOB_OFFER_CLOSED',
  OFFER_DELETED: 'VET_JOB_OFFER_DELETED',
  SEEKER_PROFILE_CREATED: 'VET_JOB_SEEKER_PROFILE_CREATED',
  SEEKER_PROFILE_UPDATED: 'VET_JOB_SEEKER_PROFILE_UPDATED',
  SEEKER_PROFILE_APPROVED: 'VET_JOB_SEEKER_PROFILE_APPROVED',
  SEEKER_PROFILE_REJECTED: 'VET_JOB_SEEKER_PROFILE_REJECTED',
  SEEKER_PROFILE_DEACTIVATED: 'VET_JOB_SEEKER_PROFILE_DEACTIVATED',
  APPLICATION_SUBMITTED: 'VET_JOB_APPLICATION_SUBMITTED',
  APPLICATION_STATUS_CHANGED: 'VET_JOB_APPLICATION_STATUS_CHANGED',
} as const;

export const VetJobAuditEntity = {
  OFFER: 'VET_JOB_OFFER',
  SEEKER_PROFILE: 'VET_JOB_SEEKER_PROFILE',
  APPLICATION: 'VET_JOB_APPLICATION',
} as const;

export const VetJobEvent = {
  OFFER_SUBMITTED: 'vet_job.offer.submitted',
  OFFER_APPROVED: 'vet_job.offer.approved',
  OFFER_REJECTED: 'vet_job.offer.rejected',
  SEEKER_PROFILE_SUBMITTED: 'vet_job.seeker_profile.submitted',
  SEEKER_PROFILE_APPROVED: 'vet_job.seeker_profile.approved',
  SEEKER_PROFILE_REJECTED: 'vet_job.seeker_profile.rejected',
  APPLICATION_RECEIVED: 'vet_job.application.received',
  APPLICATION_ACCEPTED: 'vet_job.application.accepted',
  APPLICATION_REJECTED: 'vet_job.application.rejected',
} as const;

/** RBAC: the "authorized specialist supervisor" domain for Jobs moderation. */
export const VET_JOB_SUPERVISOR_DOMAIN = 'VET_JOBS';
export const VET_JOB_PERMISSION_KEYS = ['vet_job.read', 'vet_job.approve', 'vet_job.reject'] as const;
