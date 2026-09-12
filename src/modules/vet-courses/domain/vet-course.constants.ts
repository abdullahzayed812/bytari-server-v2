/**
 * Veterinarian Courses & Seminars — domain constants.
 *
 * One moderated entity (a veterinarian-created COURSE / SEMINAR / WORKSHOP,
 * distinguished by a `type` discriminator) sharing the reusable
 * PENDING → APPROVED / REJECTED lifecycle already used by `vet-services` /
 * `vet-jobs`. One engagement entity (a veterinarian's REGISTRATION against an
 * approved course) has no moderation of its own — it either succeeds (subject
 * to capacity / deadline / duplicate checks) or is rejected synchronously by
 * the API call; there is nothing to review.
 *
 * Text + CHECK enums (not catalogue tables), mirrored by the DB CHECK
 * constraints in `20261010010000_vet_courses.ts` and by the Zod schemas.
 */

// --- moderation lifecycle (courses / seminars / workshops) -------------

export const VET_COURSE_MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type VetCourseModerationStatus = (typeof VET_COURSE_MODERATION_STATUSES)[number];

// --- controlled vocabularies ------------------------------------------

/** "دورة" / "ندوة" / "ورشة عمل" — chosen by the creator as a form field, not a separate flow. */
export const VET_COURSE_TYPES = ['COURSE', 'SEMINAR', 'WORKSHOP'] as const;
export type VetCourseType = (typeof VET_COURSE_TYPES)[number];

/** "أونلاين" / "حضوري". */
export const VET_COURSE_LOCATION_MODES = ['ONLINE', 'IN_PERSON'] as const;
export type VetCourseLocationMode = (typeof VET_COURSE_LOCATION_MODES)[number];

export const VET_COURSE_TITLE_MAX = 150;
export const VET_COURSE_DESCRIPTION_MAX = 4000;
export const VET_COURSE_TEXT_MAX = 500;
export const VET_COURSE_LIST_ITEM_MAX = 300;
export const VET_COURSE_MAX_LIST_ITEMS = 20;
export const VET_COURSE_REASON_MAX = 500;

export const VET_COURSE_MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MiB
export const VET_COURSE_ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Signed-GET TTL for a resolved cover-image URL. */
export const VET_COURSE_IMAGE_URL_TTL_SECONDS = 3600;

// --- audit + events -----------------------------------------------------

export const VetCourseAuditAction = {
  CREATED: 'VET_COURSE_CREATED',
  UPDATED: 'VET_COURSE_UPDATED',
  APPROVED: 'VET_COURSE_APPROVED',
  REJECTED: 'VET_COURSE_REJECTED',
  CANCELLED: 'VET_COURSE_CANCELLED',
  DELETED: 'VET_COURSE_DELETED',
  REGISTRATION_CREATED: 'VET_COURSE_REGISTRATION_CREATED',
} as const;

export const VetCourseAuditEntity = {
  COURSE: 'VET_COURSE',
  REGISTRATION: 'VET_COURSE_REGISTRATION',
} as const;

export const VetCourseEvent = {
  SUBMITTED: 'vet_course.submitted',
  APPROVED: 'vet_course.approved',
  REJECTED: 'vet_course.rejected',
  REGISTERED: 'vet_course.registration.created',
} as const;

/** RBAC: the "authorized specialist supervisor" domain for Courses & Seminars moderation. */
export const VET_COURSE_SUPERVISOR_DOMAIN = 'VET_COURSES';
export const VET_COURSE_PERMISSION_KEYS = [
  'vet_course.read',
  'vet_course.approve',
  'vet_course.reject',
] as const;
