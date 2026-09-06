import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import type { AuthPrincipal } from '../../src/modules/authorization/authorization.types.js';

const silent = pino({ level: 'silent' });

function makeService(heldPermissions: string[], allPermissions = ['user.read', 'user.create']) {
  const roleRepo = {
    getPermissionKeysForUser: vi.fn().mockResolvedValue(heldPermissions),
  };
  const permRepo = {
    listKeys: vi.fn().mockResolvedValue(allPermissions),
  };
  return new AuthorizationService(roleRepo as never, permRepo as never, silent);
}

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    userId: 'u1',
    email: 'u1@test',
    status: 'ACTIVE',
    veterinarianStatus: 'NOT_APPLIED',
    traderStatus: 'NOT_REGISTERED',
    roleKeys: ['PET_OWNER'],
    sessionId: null,
    ...overrides,
  };
}

describe('AuthorizationService', () => {
  it('grants a permission held through a role', async () => {
    const svc = makeService(['user.read']);
    expect(await svc.can(principal(), 'user.read')).toBe(true);
    await expect(svc.assert(principal(), 'user.read')).resolves.toBeUndefined();
  });

  it('denies a permission that is not held', async () => {
    const svc = makeService(['user.read']);
    expect(await svc.can(principal(), 'user.create')).toBe(false);
    await expect(svc.assert(principal(), 'user.create')).rejects.toBeInstanceOf(AppError);
  });

  it('ADMIN override: grants any permission without a permission lookup', async () => {
    const svc = makeService([]);
    const admin = principal({ roleKeys: ['ADMIN'] });
    expect(svc.isAdmin(admin)).toBe(true);
    expect(await svc.can(admin, 'user.create')).toBe(true);
    expect(await svc.can(admin, 'anything.at.all')).toBe(true);
    expect(await svc.getEffectivePermissions(admin)).toEqual(['user.read', 'user.create']);
  });

  it('veterinarian gating: role without APPROVED status is not an approved vet', () => {
    const svc = makeService([]);
    const pendingVet = principal({ roleKeys: ['VETERINARIAN'], veterinarianStatus: 'PENDING' });
    expect(svc.isApprovedVeterinarian(pendingVet)).toBe(false);
    expect(() => svc.assertApprovedVeterinarian(pendingVet)).toThrow(AppError);

    const rejectedVet = principal({ roleKeys: ['VETERINARIAN'], veterinarianStatus: 'REJECTED' });
    expect(() => svc.assertApprovedVeterinarian(rejectedVet)).toThrow(AppError);
  });

  it('veterinarian gating: role + APPROVED status passes', () => {
    const svc = makeService([]);
    const approved = principal({ roleKeys: ['VETERINARIAN'], veterinarianStatus: 'APPROVED' });
    expect(svc.isApprovedVeterinarian(approved)).toBe(true);
    expect(() => svc.assertApprovedVeterinarian(approved)).not.toThrow();
  });

  it('APPROVED status without the VETERINARIAN role is still not an approved vet', () => {
    const svc = makeService([]);
    const p = principal({ roleKeys: ['PET_OWNER'], veterinarianStatus: 'APPROVED' });
    expect(svc.isApprovedVeterinarian(p)).toBe(false);
  });

  it('trader gating: pure status, no role component (unlike veterinarian)', () => {
    const svc = makeService([]);
    const pending = principal({ traderStatus: 'PENDING' });
    expect(svc.isApprovedTrader(pending)).toBe(false);
    expect(() => svc.assertApprovedTrader(pending)).toThrow(AppError);

    const suspended = principal({ traderStatus: 'SUSPENDED' });
    expect(svc.isApprovedTrader(suspended)).toBe(false);

    const approved = principal({ traderStatus: 'APPROVED' });
    expect(svc.isApprovedTrader(approved)).toBe(true);
    expect(() => svc.assertApprovedTrader(approved)).not.toThrow();
  });
});
