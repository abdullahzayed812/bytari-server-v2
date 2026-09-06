/** Poultry Markets module — poultry (live bird) offer domain constants. */

export const BIRD_TYPES = ['BALADI', 'LAYER', 'BROILER', 'ROOSTER', 'TURKEY', 'OTHER'] as const;
export type BirdType = (typeof BIRD_TYPES)[number];
export const DEFAULT_BIRD_TYPE: BirdType = 'BROILER';

export const PRICING_METHODS = ['PER_KG', 'PER_BIRD'] as const;
export type PricingMethod = (typeof PRICING_METHODS)[number];
export const DEFAULT_PRICING_METHOD: PricingMethod = 'PER_KG';

export const POULTRY_OFFER_STATUSES = ['ACTIVE', 'REMOVED'] as const;
export type PoultryOfferStatus = (typeof POULTRY_OFFER_STATUSES)[number];

/** Mirrors the DB CHECK `array_length(gallery_keys, 1) <= 5`. */
export const MAX_POULTRY_OFFER_IMAGES = 5;
