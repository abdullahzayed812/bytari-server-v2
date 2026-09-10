/**
 * Phase 14 — Content domain constants. TS enums here; Zod schemas and Postgres
 * CHECKs re-encode the same closed sets independently.
 */

export const CONTENT_TYPES = ['ARTICLE', 'BOOK', 'MAGAZINE'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_FILE_KINDS = ['MAIN', 'COVER', 'ATTACHMENT'] as const;
export type ContentFileKind = (typeof CONTENT_FILE_KINDS)[number];

export const TITLE_MAX = 300;
export const DESCRIPTION_MAX = 4000;
export const BODY_MAX = 100_000;
export const AUTHOR_MAX = 200;

/** Book-only descriptive fields (meaningless for ARTICLE/MAGAZINE, left null). */
export const LANGUAGE_MAX = 50;
export const PAGE_COUNT_MAX = 100_000;
export const PUBLISH_YEAR_MIN = 1900;
export const PUBLISH_YEAR_MAX = 2100;

export const COMMENT_BODY_MAX = 2000;

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** `GET /content` sort options. Default is `latest`. */
export const CONTENT_SORTS = ['latest', 'mostRead', 'topRated'] as const;
export type ContentSort = (typeof CONTENT_SORTS)[number];

/** Hard ceiling for any single content file (100 MiB). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Seconds a signed download URL stays valid. */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * Allowed MIME types per file kind. The server validates the client-declared
 * type against this list AND re-checks the stored object's real type on
 * registration; a `null` real type (in-memory backend) falls back to the
 * declared type.
 */
export const ALLOWED_MIME: Record<ContentFileKind, readonly string[]> = {
  MAIN: ['application/pdf', 'application/epub+zip'],
  COVER: ['image/png', 'image/jpeg', 'image/webp'],
  ATTACHMENT: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
};

/**
 * Global permission keys (seeded from `rbac.constants.ts`). ADMIN keeps the
 * global override; a CONTENT system-supervisor holds the fixed set in
 * `SUPERVISOR_DOMAIN_PERMISSIONS.CONTENT` (everything except `content.delete`).
 * Normal users get NONE — public reads are not permission-gated.
 */
export const CONTENT_PERMISSION_KEYS = [
  'content.read',
  'content.create',
  'content.update',
  'content.delete',
  'content.publish',
  'content.archive',
  'content.upload',
  'content.category.manage',
] as const;
