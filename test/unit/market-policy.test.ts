import { describe, expect, it } from 'vitest';
import { MarketPolicy } from '../../src/modules/poultryMarket/domain/market.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('MarketPolicy', () => {
  describe('assertOwner', () => {
    it('passes when the actor is the offer owner', () => {
      expect(() =>
        MarketPolicy.assertOwner({ traderUserId: 'u1' }, 'u1'),
      ).not.toThrow();
    });

    it('throws when the actor is not the offer owner', () => {
      expect(() => MarketPolicy.assertOwner({ traderUserId: 'u1' }, 'u2')).toThrow(AppError);
    });
  });

  describe('assertGalleryLimit', () => {
    it('passes at exactly the limit', () => {
      expect(() => MarketPolicy.assertGalleryLimit(['a', 'b', 'c'], 3)).not.toThrow();
    });

    it('throws over the limit', () => {
      expect(() => MarketPolicy.assertGalleryLimit(['a', 'b', 'c', 'd'], 3)).toThrow(AppError);
    });

    it('passes for an empty gallery', () => {
      expect(() => MarketPolicy.assertGalleryLimit([], 5)).not.toThrow();
    });
  });
});
