/**
 * "News" domain constants — a general news type inside the content module, the
 * same shape as "Tips". Reuses the content DRAFT → PUBLISHED → ARCHIVED
 * lifecycle, the `content.*` permission keys and the CONTENT supervisor domain
 * (no new RBAC).
 */

/** Card badge tag. NORMAL renders no badge; the others map to "عاجل" / "تنبيه مهم". */
export const NEWS_TAGS = ['NORMAL', 'URGENT', 'IMPORTANT_ALERT'] as const;
export type NewsTag = (typeof NEWS_TAGS)[number];
export function isNewsTag(v: string): v is NewsTag {
  return (NEWS_TAGS as readonly string[]).includes(v);
}

/** Same closed set as `contents.status`. */
export const NEWS_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

export const TITLE_MAX = 300;
export const SUMMARY_MAX = 4000;
export const SOURCE_MAX = 200;
export const BODY_MAX = 20_000;
export const ALERT_NOTE_MAX = 2000;
export const POINT_MAX = 500;
export const MAX_POINTS = 20;

/** Attached-photo gallery cap ("الصور المرفقة"). */
export const MAX_GALLERY_IMAGES = 8;

/** Cover / gallery image ceiling (10 MiB) + allowed types — same as other image slots. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Seconds a signed image URL stays valid (only used with no public base URL). */
export const IMAGE_URL_TTL_SECONDS = 3600;
