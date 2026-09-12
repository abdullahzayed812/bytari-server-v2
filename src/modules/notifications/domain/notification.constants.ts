/**
 * Phase 15 — centralized notification-type catalogue. Handlers, policies and
 * validation reference these; no string literals scattered elsewhere. The set
 * is extensible — a future phase adds entries + a policy branch without
 * touching persistence.
 */
export const NOTIFICATION_TYPES = [
  // account
  'ACCOUNT_STATUS_CHANGED',
  // organizations
  'ORGANIZATION_APPROVED',
  'ORGANIZATION_REJECTED',
  'ORGANIZATION_SUSPENDED',
  'ORGANIZATION_ACTIVATED',
  'ORGANIZATION_MEMBER_ADDED',
  'ORGANIZATION_MEMBER_REMOVED',
  'ORGANIZATION_SUPERVISOR_ASSIGNED',
  // system supervisors
  'SYSTEM_SUPERVISOR_ASSIGNED',
  // chat
  'CHAT_MESSAGE_RECEIVED',
  // consultations
  'CONSULTATION_CREATED',
  'CONSULTATION_MESSAGE_RECEIVED',
  'CONSULTATION_CLOSED',
  // inquiries
  'INQUIRY_CREATED',
  'INQUIRY_MESSAGE_RECEIVED',
  'INQUIRY_CLOSED',
  // support messages ("تواصل معنا")
  'SUPPORT_CREATED',
  'SUPPORT_MESSAGE_RECEIVED',
  'SUPPORT_CLOSED',
  // Veterinary Services marketplace
  'VET_SERVICE_LISTING_SUBMITTED',
  'VET_SERVICE_LISTING_APPROVED',
  'VET_SERVICE_LISTING_REJECTED',
  'VET_SERVICE_REQUEST_SUBMITTED',
  'VET_SERVICE_REQUEST_APPROVED',
  'VET_SERVICE_REQUEST_REJECTED',
  'VET_SERVICE_OFFER_RECEIVED',
  'VET_SERVICE_OFFER_ACCEPTED',
  'VET_SERVICE_OFFER_REJECTED',
  'VET_SERVICE_LISTING_REQUEST_RECEIVED',
  'VET_SERVICE_LISTING_REQUEST_ACCEPTED',
  'VET_SERVICE_LISTING_REQUEST_REJECTED',
  'VET_SERVICE_DEAL_COMPLETED',
  // Veterinarian Courses & Seminars
  'VET_COURSE_SUBMITTED',
  'VET_COURSE_APPROVED',
  'VET_COURSE_REJECTED',
  'VET_COURSE_REGISTRATION_CONFIRMED',
  // Veterinary Syndicates / Unions
  'SYNDICATE_ANNOUNCEMENT_PUBLISHED',
  'SYNDICATE_SUBMISSION_CREATED',
  'SYNDICATE_SUBMISSION_RESPONDED',
  // content (catalogue entry only — no automatic broadcast; used by admin sends)
  'CONTENT_PUBLISHED',
  // animal lifecycle publications — viewer interactions
  'PUBLICATION_ADOPTION_REQUESTED',
  'PUBLICATION_MATING_REQUESTED',
  'PUBLICATION_SIGHTING_REPORTED',
  // animal ownership transfer requests
  'TRANSFER_REQUEST_RECEIVED',
  'TRANSFER_REQUEST_ACCEPTED',
  'TRANSFER_REQUEST_REJECTED',
  // clinic appointments (Pet Owner ↔ Clinic booking)
  'CLINIC_APPOINTMENT_REQUESTED',
  'CLINIC_APPOINTMENT_CONFIRMED',
  'CLINIC_APPOINTMENT_REJECTED',
  'CLINIC_APPOINTMENT_RESCHEDULE_PROPOSED',
  'CLINIC_APPOINTMENT_CANCELLED',
  'CLINIC_APPOINTMENT_COMPLETED',
  // admin
  'ADMIN_ANNOUNCEMENT',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const TITLE_MAX = 200;
export const BODY_MAX = 2000;

/** Admin broadcast recipient-selection kinds. */
export const ADMIN_TARGET_KINDS = ['USER', 'ROLE', 'ALL'] as const;
export type AdminTargetKind = (typeof ADMIN_TARGET_KINDS)[number];

/**
 * Hard cap on a single admin ROLE/ALL broadcast. Beyond this the request is
 * refused (`BROADCAST_TOO_LARGE`) — a durable queued job is the documented
 * future path (§20.4 / ARCHITECTURE §22).
 */
export const MAX_BROADCAST_RECIPIENTS = 5000;

/** FCM data payloads are string→string; keep them tiny (ids + type only). */
export const PUSH_DATA_MAX_KEYS = 12;

/** Global permission for admin broadcast. */
export const NOTIFICATION_ADMIN_SEND = 'notification.admin.send';

export function isNotificationType(v: string): v is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(v);
}
