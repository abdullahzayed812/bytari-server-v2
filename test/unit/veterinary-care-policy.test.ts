import { describe, expect, it } from 'vitest';
import { VeterinaryCarePolicy } from '../../src/modules/veterinary-care/domain/veterinary-care.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

describe('VeterinaryCarePolicy.assertVeterinaryOrgType', () => {
  it('accepts a CLINIC', () => {
    expect(() => VeterinaryCarePolicy.assertVeterinaryOrgType({ type: 'CLINIC' })).not.toThrow();
  });

  it('rejects non-clinic organization types with 400 ORGANIZATION_TYPE_NOT_SUPPORTED', () => {
    for (const type of ['FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE']) {
      try {
        VeterinaryCarePolicy.assertVeterinaryOrgType({ type });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
      }
    }
  });
});

describe('VeterinaryCarePolicy.assertAnimalActive', () => {
  it('accepts an ACTIVE animal', () => {
    expect(() => VeterinaryCarePolicy.assertAnimalActive({ status: 'ACTIVE' })).not.toThrow();
  });

  it('rejects a DEACTIVATED animal with 409 ANIMAL_NOT_ACTIVE', () => {
    try {
      VeterinaryCarePolicy.assertAnimalActive({ status: 'DEACTIVATED' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('ANIMAL_NOT_ACTIVE');
    }
  });
});
