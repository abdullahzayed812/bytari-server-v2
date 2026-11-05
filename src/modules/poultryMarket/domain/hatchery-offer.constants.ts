/** Poultry Markets module — hatchery offer ("عروض المفاقس") domain constants. */

export const CHICK_TYPES = [
  'BROILER',
  'LAYER',
  'BALADI',
  'TURKEY',
  'DUCK',
  'QUAIL',
  'OTHER',
] as const;
export type ChickType = (typeof CHICK_TYPES)[number];
export const DEFAULT_CHICK_TYPE: ChickType = 'BROILER';

export const HATCHERY_OFFER_STATUSES = ['ACTIVE', 'REMOVED'] as const;
export type HatcheryOfferStatus = (typeof HATCHERY_OFFER_STATUSES)[number];

/** Mirrors the DB CHECK `chick_age_days BETWEEN 0 AND 365`. */
export const MAX_CHICK_AGE_DAYS = 365;

/** Mirrors the DB CHECK `array_length(gallery_keys, 1) <= 4`. */
export const MAX_HATCHERY_OFFER_IMAGES = 4;
