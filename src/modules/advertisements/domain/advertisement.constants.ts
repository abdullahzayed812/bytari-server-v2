/**
 * Advertisement domain constants. One reusable system: a **campaign**
 * (`ad_campaigns`) belongs to a `placement` (the app section it renders in) and
 * has a `type` (BANNER = one slide, CAROUSEL = ordered slides). Its ordered
 * **slides** (`ad_slides`) hold the actual content — image + optional title /
 * subtitle / CTA.
 *
 * Adding a new section is a value in {@link AD_PLACEMENTS} + a one-line
 * CHECK-widening migration (see `20260908030000_advertisements.ts`) — never a
 * new table or API.
 */

export const TITLE_MAX = 200;
export const SUBTITLE_MAX = 500;
export const CTA_LABEL_MAX = 80;
export const CTA_URL_MAX = 2048;

/** Hard ceiling for a single slide image (10 MiB — small banner graphics). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Seconds a signed image URL stays valid (only used when no public base URL is configured). */
export const IMAGE_URL_TTL_SECONDS = 3600;

/** The app sections an ad campaign can target. Scalable — see file header. */
export const AD_PLACEMENTS = [
  'HOME',
  'PETS',
  'POULTRY_FARMS',
  'CLINICS',
  'VETERINARY_OFFICES',
  'VETERINARY_STORES',
  'CONSULTATIONS',
  'COURSES',
  'SEMINARS',
] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];
export const DEFAULT_AD_PLACEMENT: AdPlacement = 'HOME';
export function isAdPlacement(value: string): value is AdPlacement {
  return (AD_PLACEMENTS as readonly string[]).includes(value);
}

/** Presentation type. BANNER = exactly one slide; CAROUSEL = 1..N ordered slides. */
export const AD_TYPES = ['BANNER', 'CAROUSEL'] as const;
export type AdType = (typeof AD_TYPES)[number];
export function isAdType(value: string): value is AdType {
  return (AD_TYPES as readonly string[]).includes(value);
}

/** A BANNER campaign is capped at one slide; a CAROUSEL at a sane maximum. */
export const MAX_SLIDES_PER_TYPE: Record<AdType, number> = {
  BANNER: 1,
  CAROUSEL: 10,
};

/**
 * Global permission key (seeded from `rbac.constants.ts`). Held by ADMIN
 * (override) or an ADVERTISEMENT system-supervisor. Governs ad management for
 * ALL placements. Public reads are NOT permission-gated. Granted to NO base role.
 */
export const ADVERTISEMENT_PERMISSION_KEY = 'advertisement.manage';
