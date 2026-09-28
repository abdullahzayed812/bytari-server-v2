/**
 * Moderation lifecycle shared by poultry and egg market advertisements: a new
 * offer is PENDING (visible only to its trader and to moderators) until an
 * ADMIN or MARKET supervisor approves it; REJECTED keeps the reason.
 */
export const MARKET_MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type MarketModerationStatus = (typeof MARKET_MODERATION_STATUSES)[number];
