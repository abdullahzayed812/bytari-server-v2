/**
 * "Tips" domain constants — a structured care-advice type inside the content
 * module. Reuses the content DRAFT → PUBLISHED → ARCHIVED lifecycle, the
 * `content.*` permission keys and the CONTENT supervisor domain (no new RBAC).
 */

export const TIP_PRIORITIES = ['IMPORTANT', 'RECOMMENDED', 'NORMAL'] as const;
export type TipPriority = (typeof TIP_PRIORITIES)[number];
export function isTipPriority(v: string): v is TipPriority {
  return (TIP_PRIORITIES as readonly string[]).includes(v);
}

/** Same closed set as `contents.status`. */
export const TIP_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type TipStatus = (typeof TIP_STATUSES)[number];

export const TITLE_MAX = 300;
export const SUMMARY_MAX = 4000;
export const INTRO_MAX = 20_000;
export const VET_ADVICE_MAX = 4000;
export const POINT_MAX = 500;
export const MAX_POINTS = 20;
export const READ_MINUTES_MIN = 1;
export const READ_MINUTES_MAX = 240;

/** Cover image ceiling (10 MiB) + allowed types — same as other image slots. */
export const MAX_COVER_BYTES = 10 * 1024 * 1024;
export const ALLOWED_COVER_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Seconds a signed cover URL stays valid (only used with no public base URL). */
export const COVER_URL_TTL_SECONDS = 3600;
