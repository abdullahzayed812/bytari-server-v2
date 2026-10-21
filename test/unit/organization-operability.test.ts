import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../src/shared/errors/app-error.js';
import type { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import type { AuthPrincipal } from '../../src/modules/authorization/authorization.types.js';
import { OrganizationOperabilityService } from '../../src/modules/organizations/application/organization-operability.service.js';

const EXPIRED = { startDate: '2020-01-01', endDate: '2020-12-31' };
const VALID = { startDate: '2020-01-01', endDate: '2999-12-31' };

/** Memberships by user id: 'OWNER' | another role key; absent = not a member. */
function service(
  memberships: Record<string, string>,
  dates: { startDate: string | null; endDate: string | null } = EXPIRED,
) {
  const authz = {
    isAdmin: (p: AuthPrincipal) => p.userId === 'admin',
    getOrganizationMembershipContext: (userId: string) => {
      const roleKey = memberships[userId];
      return Promise.resolve(
        roleKey
          ? {
              membershipId: 'm',
              roleKey,
              status: 'ACTIVE',
              isOwner: roleKey === 'OWNER',
              permissions: [],
            }
          : null,
      );
    },
  } as unknown as AuthorizationService;
  return new OrganizationOperabilityService(
    { getSubscriptionDates: () => Promise.resolve(dates) },
    authz,
  );
}

const principal = (userId: string) => ({ userId }) as AuthPrincipal;
const clinic = { id: 'c1', type: 'CLINIC', status: 'ACTIVE', ownerUserId: 'owner' };
const office = { id: 'o1', type: 'VETERINARY_OFFICE', status: 'ACTIVE', ownerUserId: 'owner' };
const members = { owner: 'OWNER', vet: 'VETERINARIAN', staff: 'STAFF' };

describe('OrganizationOperabilityService.assessForUser — expired clinic', () => {
  it('the owner is locked out (SUBSCRIPTION_EXPIRED)', async () => {
    expect(await service(members).assessForUser('owner', clinic)).toEqual({
      operational: false,
      reason: 'SUBSCRIPTION_EXPIRED',
    });
  });

  it('owner_user_id alone also counts as the owner (no OWNER membership row needed)', async () => {
    expect((await service({}).assessForUser('owner', clinic)).operational).toBe(false);
  });

  it.each(['vet', 'staff'])('an ACTIVE non-owner member (%s) keeps operating', async (userId) => {
    expect(await service(members).assessForUser(userId, clinic)).toEqual({ operational: true });
  });

  it('a non-member gets the organization-level answer (locked)', async () => {
    expect((await service(members).assessForUser('stranger', clinic)).operational).toBe(false);
  });

  it('a PENDING / suspended clinic stays closed to staff too', async () => {
    for (const status of ['PENDING', 'SUSPENDED']) {
      const res = await service(members).assessForUser('vet', { ...clinic, status });
      expect(res.operational).toBe(false);
    }
  });

  it('assertOperational: owner 403, staff pass, null principal keeps the org-level rule, admin bypasses', async () => {
    const svc = service(members);
    await expect(svc.assertOperational(principal('owner'), clinic)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(svc.assertOperational(principal('vet'), clinic)).resolves.toBeUndefined();
    await expect(svc.assertOperational(null, clinic)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.assertOperational(principal('admin'), clinic)).resolves.toBeUndefined();
  });
});

describe('other organization types are unchanged', () => {
  it('an expired VETERINARY_OFFICE stays locked for its staff too', async () => {
    expect((await service(members).assessForUser('staff', office)).operational).toBe(false);
  });

  it('a valid subscription lets everyone through', async () => {
    expect((await service(members, VALID).assessForUser('owner', clinic)).operational).toBe(true);
  });
});
