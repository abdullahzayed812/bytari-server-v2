/**
 * Poultry Markets module — trader registration domain constants.
 *
 * A trader profile is a per-USER concept (`trader_profiles.user_id` UNIQUE),
 * independent of any organization/farm — a user may own zero, one, or several
 * farms and registers as a trader at most once. Status mirrors the
 * veterinarian-application vocabulary but adds `SUSPENDED` (post-approval
 * moderation state) and has no `NOT_APPLIED`-equivalent stored row — a user
 * with no `trader_profiles` row is `NOT_REGISTERED` on `users.trader_status`.
 */

export const TRADER_STATUSES = [
  'NOT_REGISTERED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type TraderStatus = (typeof TRADER_STATUSES)[number];

export const TRADER_TYPES = ['WHOLESALE', 'INDIVIDUAL', 'EXPORTER', 'OTHER'] as const;
export type TraderType = (typeof TRADER_TYPES)[number];
export const DEFAULT_TRADER_TYPE: TraderType = 'WHOLESALE';
