import { describe, expect, it } from 'vitest';
import {
  combineMarketAccess,
  evaluateFarm,
  evaluateMerchant,
} from '../../src/modules/poultryMarket/domain/market-access.js';

const NOW = new Date('2026-10-14T09:00:00Z');
const active = { subscriptionStartDate: '2026-01-01', subscriptionEndDate: '2026-12-31' };
const expired = { subscriptionStartDate: '2025-01-01', subscriptionEndDate: '2025-12-31' };
const notStarted = { subscriptionStartDate: null, subscriptionEndDate: null };
const farm = (status: string, dates: typeof active | typeof notStarted) =>
  evaluateFarm({ organizationId: 'f1', name: 'حقل', status, ...dates }, NOW);
const profile = (dates: typeof active | typeof notStarted) => ({
  ...dates,
  renewalRequestedAt: null,
});

describe('market access — merchant account', () => {
  it.each([
    ['NOT_REGISTERED', null, 'NOT_REGISTERED'],
    ['PENDING', profile(notStarted), 'PENDING_APPROVAL'],
    ['REJECTED', profile(notStarted), 'REJECTED'],
    ['SUSPENDED', profile(active), 'SUSPENDED'],
    ['APPROVED', profile(expired), 'SUBSCRIPTION_EXPIRED'],
    ['APPROVED', profile(notStarted), 'SUBSCRIPTION_NOT_STARTED'],
    ['APPROVED', profile(active), 'ELIGIBLE'],
  ] as const)('%s trader with %o → %s', (status, p, reason) => {
    const m = evaluateMerchant(status, p, NOW);
    expect(m.reason).toBe(reason);
    expect(m.eligible).toBe(reason === 'ELIGIBLE');
  });

  it('the last day of the period is still valid; a renewal (new dates) restores eligibility', () => {
    const lastDay = { subscriptionStartDate: '2026-01-01', subscriptionEndDate: '2026-10-14' };
    expect(evaluateMerchant('APPROVED', profile(lastDay), NOW).eligible).toBe(true);
    expect(evaluateMerchant('APPROVED', profile(expired), NOW).eligible).toBe(false);
    expect(evaluateMerchant('APPROVED', profile(active), NOW).eligible).toBe(true);
  });
});

describe('market access — poultry farm account', () => {
  it.each([
    ['PENDING', active, 'PENDING_APPROVAL'],
    ['SUSPENDED', active, 'NOT_ACTIVE'],
    ['REJECTED', active, 'NOT_ACTIVE'],
    ['ACTIVE', expired, 'SUBSCRIPTION_EXPIRED'],
    ['ACTIVE', notStarted, 'SUBSCRIPTION_NOT_STARTED'],
    ['ACTIVE', active, 'ELIGIBLE'],
  ] as const)('%s farm with %o → %s', (status, dates, reason) => {
    expect(farm(status, dates).reason).toBe(reason);
  });
});

describe('market access — combining independent accounts', () => {
  const none = evaluateMerchant('NOT_REGISTERED', null, NOW);
  const merchant = evaluateMerchant('APPROVED', profile(active), NOW);
  const expiredMerchant = evaluateMerchant('APPROVED', profile(expired), NOW);

  it('no eligible account → no section', () => {
    expect(combineMarketAccess(none, [farm('ACTIVE', expired)], false).sections).toEqual({
      markets: false,
      sell: false,
      poultryFarm: false,
    });
  });

  it('an eligible farm grants the markets + the farm card even when the merchant expired', () => {
    expect(combineMarketAccess(expiredMerchant, [farm('ACTIVE', active)], false).sections).toEqual({
      markets: true,
      sell: true,
      poultryFarm: true,
    });
  });

  it('an expired farm adds nothing to an eligible merchant (no farm card)', () => {
    expect(combineMarketAccess(merchant, [farm('ACTIVE', expired)], false).sections).toEqual({
      markets: true,
      sell: true,
      poultryFarm: false,
    });
  });

  it('staff browse the markets but never sell without an account', () => {
    const a = combineMarketAccess(none, [], true);
    expect(a.hasAccess).toBe(true);
    expect(a.sections).toEqual({ markets: true, sell: false, poultryFarm: false });
  });
});
