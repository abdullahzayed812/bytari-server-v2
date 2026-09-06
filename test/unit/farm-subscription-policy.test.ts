import { describe, expect, it } from 'vitest';
import { computeFarmSubscriptionStatus } from '../../src/modules/organizations/domain/organization.types.js';
import { FarmSubscriptionPolicy } from '../../src/modules/farms/domain/farm-subscription.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('computeFarmSubscriptionStatus', () => {
  const today = new Date('2026-06-15T12:00:00Z');

  it('NOT_STARTED when either date is missing', () => {
    expect(computeFarmSubscriptionStatus(null, null, today)).toBe('NOT_STARTED');
    expect(computeFarmSubscriptionStatus('2026-01-01', null, today)).toBe('NOT_STARTED');
    expect(computeFarmSubscriptionStatus(null, '2026-12-31', today)).toBe('NOT_STARTED');
  });

  it('ACTIVE when the end date is today or later', () => {
    expect(computeFarmSubscriptionStatus('2026-01-01', '2026-06-15', today)).toBe('ACTIVE');
    expect(computeFarmSubscriptionStatus('2026-01-01', '2026-06-16', today)).toBe('ACTIVE');
    expect(computeFarmSubscriptionStatus('2026-01-01', '2099-01-01', today)).toBe('ACTIVE');
  });

  it('EXPIRED the day after the end date', () => {
    expect(computeFarmSubscriptionStatus('2026-01-01', '2026-06-14', today)).toBe('EXPIRED');
    expect(computeFarmSubscriptionStatus('2020-01-01', '2020-06-01', today)).toBe('EXPIRED');
  });

  it('never trusts a client-supplied clock — defaults to the real Date when omitted', () => {
    const farFuture = computeFarmSubscriptionStatus('2020-01-01', '2099-01-01');
    expect(farFuture).toBe('ACTIVE');
  });
});

describe('FarmSubscriptionPolicy.assertValidPeriod', () => {
  it('accepts endDate >= startDate', () => {
    expect(() => FarmSubscriptionPolicy.assertValidPeriod('2026-01-01', '2026-01-01')).not.toThrow();
    expect(() => FarmSubscriptionPolicy.assertValidPeriod('2026-01-01', '2026-12-31')).not.toThrow();
  });

  it('rejects endDate before startDate with 400 INVALID_SUBSCRIPTION_DATES', () => {
    try {
      FarmSubscriptionPolicy.assertValidPeriod('2026-06-01', '2026-01-01');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe('INVALID_SUBSCRIPTION_DATES');
    }
  });
});

describe('FarmSubscriptionPolicy.assertOwner', () => {
  it('accepts the organization owner', () => {
    expect(() =>
      FarmSubscriptionPolicy.assertOwner({ ownerUserId: 'u1' }, 'u1'),
    ).not.toThrow();
  });

  it('rejects a non-owner with 403 PERMISSION_DENIED', () => {
    try {
      FarmSubscriptionPolicy.assertOwner({ ownerUserId: 'u1' }, 'u2');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).code).toBe('PERMISSION_DENIED');
    }
  });
});

describe('FarmSubscriptionPolicy.assertExpired', () => {
  it('accepts EXPIRED', () => {
    expect(() => FarmSubscriptionPolicy.assertExpired('EXPIRED')).not.toThrow();
  });

  it('rejects ACTIVE / NOT_STARTED with 409 SUBSCRIPTION_NOT_EXPIRED', () => {
    for (const status of ['ACTIVE', 'NOT_STARTED'] as const) {
      try {
        FarmSubscriptionPolicy.assertExpired(status);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('SUBSCRIPTION_NOT_EXPIRED');
      }
    }
  });
});

describe('FarmSubscriptionPolicy.assertPending', () => {
  it('accepts a PENDING request', () => {
    expect(() => FarmSubscriptionPolicy.assertPending({ status: 'PENDING' })).not.toThrow();
  });

  it('rejects an already-resolved request with 409 RENEWAL_REQUEST_NOT_PENDING', () => {
    for (const status of ['APPROVED', 'REJECTED'] as const) {
      try {
        FarmSubscriptionPolicy.assertPending({ status });
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('RENEWAL_REQUEST_NOT_PENDING');
      }
    }
  });
});
