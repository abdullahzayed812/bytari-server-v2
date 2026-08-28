import { describe, expect, it } from 'vitest';
import { AnimalPolicy } from '../../src/modules/animals/domain/animal.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('AnimalPolicy.assertMutable', () => {
  it('allows mutations on an ACTIVE animal', () => {
    expect(() => AnimalPolicy.assertMutable({ status: 'ACTIVE' })).not.toThrow();
  });

  it('rejects mutations on a DEACTIVATED animal with 409 ANIMAL_NOT_ACTIVE', () => {
    try {
      AnimalPolicy.assertMutable({ status: 'DEACTIVATED' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('ANIMAL_NOT_ACTIVE');
    }
  });
});

describe('AnimalPolicy.assertValidTransferTarget', () => {
  const currentOwner = '11111111-1111-1111-1111-111111111111';
  const other = '22222222-2222-2222-2222-222222222222';

  it('accepts an existing, active user who is not the current owner', () => {
    expect(() =>
      AnimalPolicy.assertValidTransferTarget({ id: other, status: 'ACTIVE' }, currentOwner),
    ).not.toThrow();
  });

  it('rejects a missing target with 404', () => {
    try {
      AnimalPolicy.assertValidTransferTarget(null, currentOwner);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(404);
    }
  });

  it('rejects a non-active target with 400 INVALID_TRANSFER_TARGET', () => {
    for (const status of ['SUSPENDED', 'DEACTIVATED']) {
      try {
        AnimalPolicy.assertValidTransferTarget({ id: other, status }, currentOwner);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('INVALID_TRANSFER_TARGET');
      }
    }
  });

  it('rejects transferring to the current owner with 409 INVALID_TRANSFER_TARGET', () => {
    try {
      AnimalPolicy.assertValidTransferTarget({ id: currentOwner, status: 'ACTIVE' }, currentOwner);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('INVALID_TRANSFER_TARGET');
    }
  });
});
