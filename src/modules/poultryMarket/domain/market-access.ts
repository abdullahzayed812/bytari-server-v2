import {
  computeFarmSubscriptionStatus,
  type FarmSubscriptionStatus,
} from '../../organizations/domain/organization.types.js';
import type { TraderStatus } from './trader.constants.js';

/**
 * Markets & Exchanges ("السوق وبورصات الدواجن") access — granted by either of
 * two INDEPENDENT accounts, each evaluated on its own current state:
 *
 *  - Merchant: an APPROVED trader profile whose activation period is ACTIVE.
 *  - Poultry farm: a FARM the user OWNS that is ACTIVE (approved), poultry
 *    (`farm_species` POULTRY / MIXED / legacy null — never SHEEP / CATTLE),
 *    and whose farm subscription is ACTIVE.
 *
 * An expired / pending / suspended account never grants anything; another,
 * eligible account still grants ITS sections. Every status is derived from the
 * stored dates vs today (`computeFarmSubscriptionStatus`), never a stored flag,
 * so a renewal restores access on the very next request.
 */

export type MarketMerchantReason =
  | 'ELIGIBLE'
  | 'NOT_REGISTERED'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'SUBSCRIPTION_NOT_STARTED';

export type MarketFarmReason =
  | 'ELIGIBLE'
  | 'PENDING_APPROVAL'
  | 'NOT_ACTIVE'
  | 'SUBSCRIPTION_EXPIRED'
  | 'SUBSCRIPTION_NOT_STARTED';

export interface MarketMerchantAccess {
  status: TraderStatus;
  eligible: boolean;
  reason: MarketMerchantReason;
  subscriptionStatus: FarmSubscriptionStatus | null;
  subscriptionEndDate: string | null;
  renewalRequestedAt: string | null;
}

export interface MarketFarmAccess {
  organizationId: string;
  name: string;
  status: string;
  eligible: boolean;
  reason: MarketFarmReason;
  subscriptionStatus: FarmSubscriptionStatus;
  subscriptionEndDate: string | null;
}

/** What each eligible account unlocks inside Markets & Exchanges. */
export interface MarketSections {
  /** Poultry / egg markets, both bourses, statistics. */
  markets: boolean;
  /** Publish sale offers ("نشر الإعلانات وعروض البيع"). */
  sell: boolean;
  /** The poultry farm card (an eligible owned poultry farm). */
  poultryFarm: boolean;
}

export interface MarketAccessDTO {
  hasAccess: boolean;
  /** ADMIN / MARKET supervisor — oversight access, not an account. */
  staff: boolean;
  merchant: MarketMerchantAccess;
  farms: MarketFarmAccess[];
  sections: MarketSections;
}

export function evaluateMerchant(
  traderStatus: TraderStatus,
  profile: {
    subscriptionStartDate: string | null;
    subscriptionEndDate: string | null;
    renewalRequestedAt: string | null;
  } | null,
  now: Date = new Date(),
): MarketMerchantAccess {
  const subscriptionStatus = profile
    ? computeFarmSubscriptionStatus(profile.subscriptionStartDate, profile.subscriptionEndDate, now)
    : null;
  let reason: MarketMerchantReason;
  if (traderStatus === 'NOT_REGISTERED' || !profile) reason = 'NOT_REGISTERED';
  else if (traderStatus === 'PENDING') reason = 'PENDING_APPROVAL';
  else if (traderStatus === 'REJECTED') reason = 'REJECTED';
  else if (traderStatus === 'SUSPENDED') reason = 'SUSPENDED';
  else if (subscriptionStatus === 'EXPIRED') reason = 'SUBSCRIPTION_EXPIRED';
  else if (subscriptionStatus === 'NOT_STARTED') reason = 'SUBSCRIPTION_NOT_STARTED';
  else reason = 'ELIGIBLE';
  return {
    status: traderStatus,
    eligible: reason === 'ELIGIBLE',
    reason,
    subscriptionStatus,
    subscriptionEndDate: profile?.subscriptionEndDate ?? null,
    renewalRequestedAt: profile?.renewalRequestedAt ?? null,
  };
}

export function evaluateFarm(
  farm: {
    organizationId: string;
    name: string;
    status: string;
    subscriptionStartDate: string | null;
    subscriptionEndDate: string | null;
  },
  now: Date = new Date(),
): MarketFarmAccess {
  const subscriptionStatus = computeFarmSubscriptionStatus(
    farm.subscriptionStartDate,
    farm.subscriptionEndDate,
    now,
  );
  let reason: MarketFarmReason;
  if (farm.status === 'PENDING') reason = 'PENDING_APPROVAL';
  else if (farm.status !== 'ACTIVE') reason = 'NOT_ACTIVE';
  else if (subscriptionStatus === 'EXPIRED') reason = 'SUBSCRIPTION_EXPIRED';
  else if (subscriptionStatus === 'NOT_STARTED') reason = 'SUBSCRIPTION_NOT_STARTED';
  else reason = 'ELIGIBLE';
  return {
    organizationId: farm.organizationId,
    name: farm.name,
    status: farm.status,
    eligible: reason === 'ELIGIBLE',
    reason,
    subscriptionStatus,
    subscriptionEndDate: farm.subscriptionEndDate,
  };
}

/** Combine the independently evaluated accounts. Staff see the markets, but sell only via an account. */
export function combineMarketAccess(
  merchant: MarketMerchantAccess,
  farms: MarketFarmAccess[],
  staff: boolean,
): MarketAccessDTO {
  const farmEligible = farms.some((f) => f.eligible);
  const account = merchant.eligible || farmEligible;
  return {
    hasAccess: account || staff,
    staff,
    merchant,
    farms,
    sections: {
      markets: account || staff,
      sell: account,
      poultryFarm: farmEligible,
    },
  };
}
