/**
 * Phase 12 — Chat domain constants. TypeScript enums here, the Zod schemas in
 * `chat.schemas.ts`, and the Postgres CHECK constraints in the migration are
 * three independent encodings of the same closed sets (defence in depth).
 */

/**
 * Conversation contexts. The first two (docs 01 §9, UC-018 / UC-019) are
 * organization-anchored; PET_OWNER_VETERINARIAN is a direct 1:1 marketplace
 * deal chat (no org) linked to a vet-service engagement.
 */
export const CONVERSATION_TYPES = [
  'PET_OWNER_CLINIC',
  'FARM_OWNER_MEMBER',
  'PET_OWNER_VETERINARIAN',
  'PET_OWNER_VETERINARY_OFFICE',
  /**
   * Global Chat — a public, many-member discussion room. `organization_id` is
   * a CHAT_ROOM organization; every member gets an explicit
   * `conversation_participants` row (role `ROOM_MEMBER`) since, unlike
   * CLINIC/OFFICE, there is no "resolve the org side live" shortcut for a
   * room with potentially hundreds of members.
   */
  'CHAT_ROOM',
  /**
   * Syndicate admin ↔ one registered syndicate member. Same shape as
   * PET_OWNER_VETERINARY_OFFICE: `organization_id` is the SYNDICATE (org side
   * resolved live from ACTIVE membership, no participant row) and
   * `pet_owner_user_id` holds the member (participant role `SYNDICATE_MEMBER`).
   * Only ever opened by an officer holding `syndicate.member.message`.
   */
  'SYNDICATE_MEMBER',
  /**
   * Adoption / Mating / Lost listing contact — the interested user
   * (`pet_owner_user_id`, participant role `PET_OWNER`) ↔ the listing owner
   * (`member_user_id`, role `LISTING_OWNER`), pinned to the publication
   * (`subject_type` ANIMAL_PUBLICATION). One per (listing, interested user);
   * both sides have explicit participant rows.
   */
  'ANIMAL_PUBLICATION',
  /**
   * Two ACTIVE non-owner members of the same farm (e.g. its veterinarian and
   * an employee) — explicit FARM_MEMBER rows for both; access re-checked live.
   */
  'FARM_MEMBER_DIRECT',
] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

/**
 * Context label on a `conversation_participants` row. The CLINIC side of a
 * PET_OWNER_CLINIC conversation has NO participant row — it is resolved live
 * from `organization_memberships` — so there is no `CLINIC` participant role.
 * PET_OWNER_VETERINARIAN has an explicit row for BOTH sides. `ROOM_MEMBER` is
 * every member of a CHAT_ROOM (all explicit rows, see `CONVERSATION_TYPES`).
 */
export const PARTICIPANT_ROLES = [
  'PET_OWNER',
  'FARM_OWNER',
  'FARM_MEMBER',
  'VETERINARIAN',
  'ROOM_MEMBER',
  'SYNDICATE_MEMBER',
  'LISTING_OWNER',
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/** Resolved access side for a caller on a conversation (superset of participant roles). */
export const CONVERSATION_SIDES = [
  'PET_OWNER',
  'CLINIC',
  'FARM_OWNER',
  'FARM_MEMBER',
  'VETERINARIAN',
  'VETERINARY_OFFICE',
  'ROOM_MEMBER',
  'SYNDICATE',
  'SYNDICATE_MEMBER',
  'LISTING_OWNER',
] as const;
export type ConversationSide = (typeof CONVERSATION_SIDES)[number];

/** Job lifecycle of a marketplace deal conversation. */
export const CONVERSATION_STATUSES = ['OPEN', 'COMPLETED', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Entities a PET_OWNER_VETERINARIAN conversation can be pinned to. */
export const CONVERSATION_SUBJECT_TYPES = [
  'VET_SERVICE_OFFER',
  'VET_SERVICE_LISTING_REQUEST',
  'VET_JOB_APPLICATION',
  'ANIMAL_PUBLICATION',
] as const;
export type ConversationSubjectType = (typeof CONVERSATION_SUBJECT_TYPES)[number];

export const MESSAGE_TYPES = ['TEXT', 'SYSTEM'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_BODY_MAX = 4000;

// --- chat media (one optional attachment per message) ------------------

export const CHAT_ATTACHMENT_KINDS = ['IMAGE', 'VIDEO', 'FILE'] as const;
export type ChatAttachmentKind = (typeof CHAT_ATTACHMENT_KINDS)[number];

/**
 * MIME allow-list per kind. Checked on the declared type at presign AND on the
 * stored object's verified (magic-byte) type at send.
 */
export const CHAT_ATTACHMENT_MIME: Record<ChatAttachmentKind, readonly string[]> = {
  IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  VIDEO: ['video/mp4', 'video/quicktime', 'video/3gpp', 'video/webm'],
  FILE: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ],
};

/** Per-kind byte ceilings. */
export const CHAT_ATTACHMENT_MAX_BYTES: Record<ChatAttachmentKind, number> = {
  IMAGE: 10 * 1024 * 1024,
  VIDEO: 50 * 1024 * 1024,
  FILE: 20 * 1024 * 1024,
};

export const CHAT_ATTACHMENT_FILENAME_MAX = 255;
/** Presigned PUT lifetime. */
export const CHAT_ATTACHMENT_UPLOAD_TTL_SECONDS = 600;
/** Signed GET lifetime for rendering / downloading an attachment. */
export const CHAT_ATTACHMENT_URL_TTL_SECONDS = 3600;

/**
 * Global permission keys (seeded from the RBAC constants). Chat access is
 * RELATIONSHIP-scoped — these exist for the ADMIN override and a future
 * Communication-Supervisor delegation, and are granted to NO base role.
 */
export const CHAT_PERMISSION_KEYS = ['chat.read', 'chat.send', 'chat.delete'] as const;
export type ChatPermissionKey = (typeof CHAT_PERMISSION_KEYS)[number];

/**
 * Organization types that support chat (docs 01 §9: Clinic Chat + Farm Chat, extended by
 * the Veterinary Office Dashboard's "المحادثات" screen to VETERINARY_OFFICE — same shape
 * as CLINIC: org side resolved live via ACTIVE membership, no participant row).
 */
export const CHAT_ORG_TYPES = ['CLINIC', 'FARM', 'VETERINARY_OFFICE'] as const;
