import { describe, expect, it } from 'vitest';
import { FarmPolicy } from '../../src/modules/farms/domain/farm.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('FarmPolicy.assertFarmOrganization', () => {
  it('accepts a FARM', () => {
    expect(() => FarmPolicy.assertFarmOrganization({ type: 'FARM' })).not.toThrow();
  });
  it('rejects non-FARM types with 400 ORGANIZATION_TYPE_NOT_SUPPORTED', () => {
    for (const type of ['CLINIC', 'VETERINARY_OFFICE', 'VETERINARY_STORE']) {
      try {
        FarmPolicy.assertFarmOrganization({ type });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
      }
    }
  });
});

describe('FarmPolicy.assertFarmJoinable', () => {
  it('accepts an ACTIVE farm', () => {
    expect(() => FarmPolicy.assertFarmJoinable({ status: 'ACTIVE' })).not.toThrow();
  });
  it('rejects a non-ACTIVE farm with 409 ORGANIZATION_NOT_ACTIVE', () => {
    for (const status of ['PENDING', 'REJECTED', 'SUSPENDED', 'DEACTIVATED']) {
      try {
        FarmPolicy.assertFarmJoinable({ status });
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('ORGANIZATION_NOT_ACTIVE');
      }
    }
  });
});

describe('FarmPolicy.resolveJoinAction', () => {
  it('no membership → create', () => {
    expect(FarmPolicy.resolveJoinAction(null)).toBe('create');
  });
  it('LEFT membership → reactivate', () => {
    expect(FarmPolicy.resolveJoinAction('LEFT')).toBe('reactivate');
  });
  it('ACTIVE membership → noop (idempotent)', () => {
    expect(FarmPolicy.resolveJoinAction('ACTIVE')).toBe('noop');
  });
  it('SUSPENDED / REMOVED → refused (self-service rejoin not allowed)', () => {
    for (const s of ['SUSPENDED', 'REMOVED'] as const) {
      try {
        FarmPolicy.resolveJoinAction(s);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(403);
      }
    }
  });
});

describe('FarmPolicy.assertFlockMutable', () => {
  it('accepts an ACTIVE flock', () => {
    expect(() => FarmPolicy.assertFlockMutable({ status: 'ACTIVE' })).not.toThrow();
  });
  it('rejects a CLOSED flock with 409 POULTRY_FLOCK_NOT_ACTIVE', () => {
    try {
      FarmPolicy.assertFlockMutable({ status: 'CLOSED' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('POULTRY_FLOCK_NOT_ACTIVE');
    }
  });
});
