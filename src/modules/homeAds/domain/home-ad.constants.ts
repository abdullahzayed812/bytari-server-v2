/**
 * Home ads (promotional banner carousel) domain constants.
 */

export const TITLE_MAX = 200;
export const SUBTITLE_MAX = 500;

/** Hard ceiling for a single ad image (10 MiB — these are small banner graphics). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Seconds a signed image URL stays valid (only used when no public base URL is configured). */
export const IMAGE_URL_TTL_SECONDS = 3600;

/**
 * Global permission key (seeded from `rbac.constants.ts`). Held by ADMIN
 * (override) or a HOME_AD system-supervisor. Public reads are NOT
 * permission-gated. Granted to NO base role.
 */
export const HOME_AD_PERMISSION_KEY = 'home_ad.manage';
