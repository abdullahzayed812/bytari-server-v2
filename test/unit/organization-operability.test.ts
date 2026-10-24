import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../src/shared/errors/app-error.js';
import { ErrorCode } from '../../src/shared/errors/error-codes.js';
import type { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import type { AuthPrincipal } from '../../src/modules/authorization/authorization.types.js';
import { OrganizationOperabilityService } from '../../src/modules/organizations/application/organization-operability.service.js';

const EXPIRED = { startDate: '2020-01-01', endDate: '2020-12-31' };
const VALID = { startDate: '2020-01-01', endDate: '2999-12-31' };
const NOT_STARTED = { startDate: null, endDate: null };

function service(dates: { startDate: string | null; endDate: string | null } = EXPIRED) {
  const authz = {
    isAdmin: (p: AuthPrincipal) => p.userId === 'admin',
  } as unknown as AuthorizationService;
  return new OrganizationOperabilityService(
    { getSubscriptionDates: () => Promise.resolve(dates) },
    authz,
  );
}

const principal = (userId: string) => ({ userId }) as AuthPrincipal;
const clinic = { id: 'c1', type: 'CLINIC', status: 'ACTIVE' };
const office = { id: 'o1', type: 'VETERINARY_OFFICE', status: 'ACTIVE' };
const farm = { id: 'f1', type: 'FARM', status: 'ACTIVE' };

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenError);
    return (err as ForbiddenError).code;
  }
}

describe('OrganizationOperabilityService — expired subscription locks every member', () => {
  it.each([clinic, office])('$type: SUBSCRIPTION_EXPIRED', async (org) => {
    expect(await service().assess(org)).toEqual({
      operational: false,
      reason: 'SUBSCRIPTION_EXPIRED',
    });
  });

  it.each(['owner', 'vet', 'supervisor', 'staff', 'stranger'])(
    'assertOperational refuses %s on an expired clinic / office (no staff exemption)',
    async (userId) => {
      for (const org of [clinic, office]) {
        expect(await codeOf(service().assertOperational(principal(userId), org))).toBe(
          ErrorCode.ORGANIZATION_SUBSCRIPTION_EXPIRED,
        );
      }
    },
  );

  it('a null principal (counterpart-neutral check) gets the same answer', async () => {
    expect(await codeOf(service().assertOperational(null, clinic))).toBe(
      ErrorCode.ORGANIZATION_SUBSCRIPTION_EXPIRED,
    );
  });

  it('a global ADMIN bypasses', async () => {
    await expect(service().assertOperational(principal('admin'), clinic)).resolves.toBeUndefined();
  });

  it('PENDING / SUSPENDED stay closed regardless of the subscription', async () => {
    const svc = service(VALID);
    expect(await svc.assess({ ...clinic, status: 'PENDING' })).toEqual({
      operational: false,
      reason: 'PENDING_APPROVAL',
    });
    expect(
      await codeOf(svc.assertOperational(principal('vet'), { ...clinic, status: 'SUSPENDED' })),
    ).toBe(ErrorCode.ORGANIZATION_NOT_ACTIVE);
  });

  it('a valid subscription lets everyone through', async () => {
    await expect(
      service(VALID).assertOperational(principal('vet'), clinic),
    ).resolves.toBeUndefined();
    await expect(service(VALID).assertOperational(null, office)).resolves.toBeUndefined();
  });
});

describe('FARM — strict rule (subscription must be ACTIVE)', () => {
  it.each([
    ['EXPIRED', EXPIRED],
    ['NOT_STARTED', NOT_STARTED],
  ] as const)('%s → FARM_SUBSCRIPTION_NOT_ACTIVE', async (_label, dates) => {
    expect(await service(dates).assess(farm)).toEqual({
      operational: false,
      reason: 'FARM_SUBSCRIPTION_NOT_ACTIVE',
    });
    expect(await codeOf(service(dates).assertOperational(principal('staff'), farm))).toBe(
      ErrorCode.FARM_SUBSCRIPTION_NOT_ACTIVE,
    );
  });

  it('ACTIVE → operational', async () => {
    expect(await service(VALID).assess(farm)).toEqual({ operational: true });
  });

  it('a NOT_STARTED clinic is still operational (only EXPIRED locks a clinic / office)', async () => {
    expect(await service(NOT_STARTED).assess(clinic)).toEqual({ operational: true });
  });
});
