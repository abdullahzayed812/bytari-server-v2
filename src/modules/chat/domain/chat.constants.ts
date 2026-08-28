/**
 * Phase 12 — Chat domain constants. TypeScript enums here, the Zod schemas in
 * `chat.schemas.ts`, and the Postgres CHECK constraints in the migration are
 * three independent encodings of the same closed sets (defence in depth).
 */

/** The two confirmed conversation contexts (docs 01 §9, UC-018 / UC-019). */
export const CONVERSATION_TYPES = ['PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER'] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

/**
 * Context label on a `conversation_participants` row. The CLINIC side of a
 * PET_OWNER_CLINIC conversation has NO participant row — it is resolved live
 * from `organization_memberships` — so there is no `CLINIC` participant role.
 */
export const PARTICIPANT_ROLES = ['PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/** Resolved access side for a caller on a conversation (superset of participant roles). */
export const CONVERSATION_SIDES = ['PET_OWNER', 'CLINIC', 'FARM_OWNER', 'FARM_MEMBER'] as const;
export type ConversationSide = (typeof CONVERSATION_SIDES)[number];

export const MESSAGE_TYPES = ['TEXT', 'SYSTEM'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_BODY_MAX = 4000;

/**
 * Global permission keys (seeded from the RBAC constants). Chat access is
 * RELATIONSHIP-scoped — these exist for the ADMIN override and a future
 * Communication-Supervisor delegation, and are granted to NO base role.
 */
export const CHAT_PERMISSION_KEYS = ['chat.read', 'chat.send', 'chat.delete'] as const;
export type ChatPermissionKey = (typeof CHAT_PERMISSION_KEYS)[number];

/** Organization types that support chat (docs 01 §9: Clinic Chat + Farm Chat). */
export const CHAT_ORG_TYPES = ['CLINIC', 'FARM'] as const;
