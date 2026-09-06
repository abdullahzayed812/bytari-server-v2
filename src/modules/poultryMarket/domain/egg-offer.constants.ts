/** Poultry Markets module — egg offer domain constants. */

export const EGG_TYPES = ['ORGANIC', 'BROWN', 'WHITE', 'OTHER', 'TURKEY', 'BALADI'] as const;
export type EggType = (typeof EGG_TYPES)[number];
export const DEFAULT_EGG_TYPE: EggType = 'WHITE';

export const SELL_UNITS = ['PIECE', 'CARTON_360', 'TRAY_30'] as const;
export type SellUnit = (typeof SELL_UNITS)[number];
export const DEFAULT_SELL_UNIT: SellUnit = 'TRAY_30';

export const EGG_OFFER_STATUSES = ['ACTIVE', 'REMOVED'] as const;
export type EggOfferStatus = (typeof EGG_OFFER_STATUSES)[number];

/** Mirrors the DB CHECK `array_length(gallery_keys, 1) <= 4`. */
export const MAX_EGG_OFFER_IMAGES = 4;
