/**
 * Veterinary Syndicates / Unions ("نقابة الأطباء البيطريين").
 *
 * A syndicate is an `organizations` row (`type = 'SYNDICATE'`) — reusing the
 * existing organization aggregate, its `organization_memberships` /
 * `organization_supervisor_permissions` per-instance RBAC
 * (`AuthorizationService.canInOrganization`/`assertInOrganization`), and its
 * generic follow feature (`organization_follows`) as-is. Only a syndicate's
 * OWN profile fields (`syndicate_details`), announcements
 * (`syndicate_announcements`) and requests/inquiries (`syndicate_submissions`)
 * are new.
 *
 * Hierarchy: a MAIN syndicate has `parent_organization_id = NULL`; a
 * SUBORDINATE/branch syndicate has it set to a main syndicate's organization
 * id. Exactly one level deep (`SyndicatePolicy.assertValidParent`) — a branch
 * cannot itself have branches.
 *
 * Unlike the moderated marketplaces (vet-services / vet-jobs / vet-courses),
 * syndicates are created by an ADMIN directly (never self-submitted), so they
 * start ACTIVE and announcements publish immediately — there is no
 * PENDING → APPROVED/REJECTED lifecycle here.
 */

export const SYNDICATE_ANNOUNCEMENT_TYPES = ['ANNOUNCEMENT', 'IMPORTANT_NOTICE'] as const;
export type SyndicateAnnouncementType = (typeof SYNDICATE_ANNOUNCEMENT_TYPES)[number];

export const SYNDICATE_SUBMISSION_KINDS = ['REQUEST', 'INQUIRY'] as const;
export type SyndicateSubmissionKind = (typeof SYNDICATE_SUBMISSION_KINDS)[number];

/** Only meaningful when `kind = 'REQUEST'`. Matches the "الخدمات" tiles shown to members. */
export const SYNDICATE_REQUEST_TYPES = [
  'ID_ISSUANCE',
  'ID_RENEWAL',
  'OFFICE_LICENSE_ISSUANCE',
  'OFFICE_LICENSE_RENEWAL',
  'OTHER',
] as const;
export type SyndicateRequestType = (typeof SYNDICATE_REQUEST_TYPES)[number];

export const SYNDICATE_SUBMISSION_STATUSES = ['PENDING', 'RESPONDED', 'CLOSED'] as const;
export type SyndicateSubmissionStatus = (typeof SYNDICATE_SUBMISSION_STATUSES)[number];

export const SYNDICATE_NAME_MAX = 160;
export const SYNDICATE_DESCRIPTION_MAX = 2000;
export const SYNDICATE_TEXT_MAX = 500;
export const SYNDICATE_TITLE_MAX = 150;
export const SYNDICATE_BODY_MAX = 4000;
export const SYNDICATE_MESSAGE_MAX = 1000;
export const SYNDICATE_RESPONSE_MAX = 2000;

/** "الحد الأقصى 5 صور - كل صورة 5 ميجابايت" — the inquiry/request attachment form. */
export const SYNDICATE_MAX_ATTACHMENTS = 5;
export const SYNDICATE_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const SYNDICATE_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const SYNDICATE_ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const SYNDICATE_IMAGE_URL_TTL_SECONDS = 3600;

export const SyndicateAuditAction = {
  CREATED: 'SYNDICATE_CREATED',
  PROFILE_UPDATED: 'SYNDICATE_PROFILE_UPDATED',
  ANNOUNCEMENT_CREATED: 'SYNDICATE_ANNOUNCEMENT_CREATED',
  ANNOUNCEMENT_UPDATED: 'SYNDICATE_ANNOUNCEMENT_UPDATED',
  ANNOUNCEMENT_DELETED: 'SYNDICATE_ANNOUNCEMENT_DELETED',
  SUBMISSION_CREATED: 'SYNDICATE_SUBMISSION_CREATED',
  SUBMISSION_RESPONDED: 'SYNDICATE_SUBMISSION_RESPONDED',
  SUBMISSION_CLOSED: 'SYNDICATE_SUBMISSION_CLOSED',
} as const;

export const SyndicateAuditEntity = {
  SYNDICATE: 'SYNDICATE',
  ANNOUNCEMENT: 'SYNDICATE_ANNOUNCEMENT',
  SUBMISSION: 'SYNDICATE_SUBMISSION',
} as const;

export const SyndicateEvent = {
  CREATED: 'syndicate.created',
  ANNOUNCEMENT_PUBLISHED: 'syndicate.announcement.published',
  SUBMISSION_CREATED: 'syndicate.submission.created',
  SUBMISSION_RESPONDED: 'syndicate.submission.responded',
} as const;

/**
 * Organization-scoped permission keys (`ORG_PERMISSION_KEYS` in
 * `organization-rbac.constants.ts`) — granted per-membership via the existing
 * `POST /organizations/:organizationId/supervisors` flow, exactly like every
 * other org-scoped permission. Re-exported here only for convenient reference
 * from this module's own services/routes.
 */
export const SYNDICATE_PERMISSION_KEYS = [
  'syndicate.profile.manage',
  'syndicate.announcement.manage',
  'syndicate.submission.read',
  'syndicate.submission.respond',
] as const;
