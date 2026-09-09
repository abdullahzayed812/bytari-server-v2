/**
 * Phase 13 — Consultations & Inquiries share one thread kernel. This file holds
 * the closed sets (TS enums); Zod schemas and Postgres CHECKs re-encode them
 * independently.
 */

export const THREAD_KINDS = ['CONSULTATION', 'INQUIRY', 'SUPPORT'] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

export const THREAD_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/** Who a message came from. `sender_user_id` is NULL for AI / SYSTEM. */
export const MESSAGE_SOURCES = ['USER', 'SUPERVISOR', 'ADMIN', 'AI', 'SYSTEM'] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

/** Caller's resolved relationship to a thread. */
export type ThreadSide = 'CREATOR' | 'RESPONDER';

export const MESSAGE_BODY_MAX = 4000;

/**
 * Global permission keys (seeded from `rbac.constants.ts`). Thread access is
 * RELATIONSHIP-scoped for the creator; RESPONDER access flows through
 * `AuthorizationService` — ADMIN override, or the CONSULTATION / INQUIRY
 * system-supervisor domain (`SUPERVISOR_DOMAIN_PERMISSIONS`). `*.create` keys
 * are reserved (creation is authentication + eligibility only, like
 * `animal.create`).
 */
export const CONSULTATION_PERMISSION_KEYS = [
  'consultation.create',
  'consultation.read',
  'consultation.respond',
  'consultation.close',
  'consultation.admin.read',
] as const;

export const INQUIRY_PERMISSION_KEYS = [
  'inquiry.create',
  'inquiry.read',
  'inquiry.respond',
  'inquiry.close',
  'inquiry.admin.read',
] as const;

/**
 * Support messages ("تواصل معنا"). Same thread kernel as CONSULTATION / INQUIRY;
 * creation is authentication-only (ANY signed-in user, no eligibility gate).
 * RESPONDER access = ADMIN override or an ACTIVE SUPPORT system-supervisor.
 */
export const SUPPORT_PERMISSION_KEYS = [
  'support.create',
  'support.read',
  'support.respond',
  'support.close',
  'support.admin.read',
] as const;

export const AI_PERMISSION_KEYS = ['ai.settings.manage'] as const;

export const AI_SETTING_KEYS = ['CONSULTATION_AI', 'INQUIRY_AI', 'SUPPORT_AI'] as const;
export type AiSettingKey = (typeof AI_SETTING_KEYS)[number];
