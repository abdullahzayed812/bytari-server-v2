import { describe, expect, it } from 'vitest';
import { OrganizationPolicy } from '../../src/modules/organizations/domain/organization.policy.js';
import { AppError } from '../../src/shared/errors/app-error.js';

const approvedVet = { status: 'ACTIVE', veterinarianStatus: 'APPROVED' };
const plainUser = { status: 'ACTIVE', veterinarianStatus: 'NOT_APPLIED' };

describe('OrganizationPolicy.assertCanCreate', () => {
  it('allows an approved vet to create CLINIC / FARM', () => {
    expect(() => OrganizationPolicy.assertCanCreate('CLINIC', approvedVet)).not.toThrow();
    expect(() => OrganizationPolicy.assertCanCreate('FARM', approvedVet)).not.toThrow();
  });

  it('blocks a non-approved vet from CLINIC / FARM with VETERINARIAN_APPROVAL_REQUIRED', () => {
    const cases = [
      plainUser,
      { status: 'ACTIVE', veterinarianStatus: 'PENDING' },
      { status: 'ACTIVE', veterinarianStatus: 'REJECTED' },
    ];
    for (const user of cases) {
      for (const type of ['CLINIC', 'FARM'] as const) {
        try {
          OrganizationPolicy.assertCanCreate(type, user);
          throw new Error('expected throw');
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          expect((err as AppError).code).toBe('VETERINARIAN_APPROVAL_REQUIRED');
          expect((err as AppError).statusCode).toBe(403);
        }
      }
    }
  });

  it('allows anyone to create VETERINARY_OFFICE / VETERINARY_STORE', () => {
    expect(() => OrganizationPolicy.assertCanCreate('VETERINARY_OFFICE', plainUser)).not.toThrow();
    expect(() => OrganizationPolicy.assertCanCreate('VETERINARY_STORE', plainUser)).not.toThrow();
  });

  it('blocks a non-active account regardless of type', () => {
    expect(() =>
      OrganizationPolicy.assertCanCreate('VETERINARY_STORE', {
        status: 'SUSPENDED',
        veterinarianStatus: 'APPROVED',
      }),
    ).toThrow(AppError);
  });
});

describe('OrganizationPolicy other rules', () => {
  it('assertCanBeSupervisor requires an approved veterinarian', () => {
    expect(() =>
      OrganizationPolicy.assertCanBeSupervisor({ veterinarianStatus: 'APPROVED' }),
    ).not.toThrow();
    expect(() =>
      OrganizationPolicy.assertCanBeSupervisor({ veterinarianStatus: 'PENDING' }),
    ).toThrow(AppError);
  });

  it('assertCanHoldRole gates the VETERINARIAN org role on approved status', () => {
    expect(() =>
      OrganizationPolicy.assertCanHoldRole('VETERINARIAN', { veterinarianStatus: 'APPROVED' }),
    ).not.toThrow();
    expect(() =>
      OrganizationPolicy.assertCanHoldRole('VETERINARIAN', { veterinarianStatus: 'NOT_APPLIED' }),
    ).toThrow(AppError);
    // STAFF has no vet requirement
    expect(() =>
      OrganizationPolicy.assertCanHoldRole('STAFF', { veterinarianStatus: 'NOT_APPLIED' }),
    ).not.toThrow();
  });

  it('ownerMustBeApprovedVeterinarian / hasJoinCode reflect the type table', () => {
    expect(OrganizationPolicy.ownerMustBeApprovedVeterinarian('CLINIC')).toBe(true);
    expect(OrganizationPolicy.ownerMustBeApprovedVeterinarian('FARM')).toBe(true);
    expect(OrganizationPolicy.ownerMustBeApprovedVeterinarian('VETERINARY_OFFICE')).toBe(false);
    expect(OrganizationPolicy.ownerMustBeApprovedVeterinarian('VETERINARY_STORE')).toBe(false);
    expect(OrganizationPolicy.hasJoinCode('FARM')).toBe(true);
    expect(OrganizationPolicy.hasJoinCode('CLINIC')).toBe(false);
  });

  it('generateJoinCode yields a FARM-prefixed unambiguous code', () => {
    const code = OrganizationPolicy.generateJoinCode();
    expect(code).toMatch(/^FARM-[A-HJ-NP-Z2-9]{6}$/);
    expect(OrganizationPolicy.generateJoinCode()).not.toBe(code);
  });
});
