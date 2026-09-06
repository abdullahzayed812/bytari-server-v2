import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import type { AuthPrincipal } from '../../src/modules/authorization/authorization.types.js';

const silent = pino({ level: 'silent' });

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    userId: 'u1',
    email: 'u1@test',
    status: 'ACTIVE',
    veterinarianStatus: 'APPROVED',
    traderStatus: 'NOT_REGISTERED',
    roleKeys: ['VETERINARIAN'],
    sessionId: null,
    ...overrides,
  };
}

interface FakeMembership {
  id: string;
  roleKey: string;
  status: string;
}

function build(opts: {
  membership?: FakeMembership | null;
  rolePerms?: string[];
  supervisorPerms?: string[];
}) {
  const memberships = {
    findByUserAndOrg: vi
      .fn()
      .mockResolvedValue(
        opts.membership === undefined
          ? { id: 'm1', roleKey: 'VETERINARIAN', status: 'ACTIVE' }
          : opts.membership,
      ),
  };
  const orgRbac = {
    findRoleByKey: vi.fn().mockResolvedValue({ id: 'role-1', key: 'x' }),
    getPermissionKeysForRole: vi.fn().mockResolvedValue(opts.rolePerms ?? []),
    getSupervisorPermissionKeys: vi.fn().mockResolvedValue(opts.supervisorPerms ?? []),
  };
  const roles = { getPermissionKeysForUser: vi.fn().mockResolvedValue([]) };
  const permissions = { listKeys: vi.fn().mockResolvedValue([]) };
  const svc = new AuthorizationService(roles as never, permissions as never, silent, {
    memberships: memberships as never,
    orgRbac: orgRbac as never,
  });
  return { svc, memberships, orgRbac };
}

describe('AuthorizationService — organization scope', () => {
  it('ADMIN override grants any org permission without touching membership repos', async () => {
    const { svc, memberships } = build({ membership: null });
    const admin = principal({ roleKeys: ['ADMIN'] });
    expect(await svc.canInOrganization(admin, 'member.remove', 'org-1')).toBe(true);
    expect(memberships.findByUserAndOrg).not.toHaveBeenCalled();
  });

  it('no ACTIVE membership → denied', async () => {
    const { svc } = build({ membership: null });
    expect(await svc.canInOrganization(principal(), 'member.read', 'org-1')).toBe(false);
    await expect(
      svc.assertInOrganization(principal(), 'member.read', 'org-1'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('a SUSPENDED membership is treated as no membership', async () => {
    const { svc } = build({
      membership: { id: 'm1', roleKey: 'VETERINARIAN', status: 'SUSPENDED' },
    });
    expect(await svc.canInOrganization(principal(), 'organization.read', 'org-1')).toBe(false);
  });

  it('OWNER membership → full organization access (owner override)', async () => {
    const { svc, orgRbac } = build({
      membership: { id: 'm1', roleKey: 'OWNER', status: 'ACTIVE' },
    });
    expect(await svc.canInOrganization(principal(), 'anything.at.all', 'org-1')).toBe(true);
    // owner override short-circuits before role-permission lookup
    expect(orgRbac.getPermissionKeysForRole).not.toHaveBeenCalled();
  });

  it('a non-owner gets exactly their org role permissions', async () => {
    const { svc } = build({
      membership: { id: 'm1', roleKey: 'VETERINARIAN', status: 'ACTIVE' },
      rolePerms: ['organization.read', 'member.read'],
    });
    expect(await svc.canInOrganization(principal(), 'member.read', 'org-1')).toBe(true);
    expect(await svc.canInOrganization(principal(), 'member.remove', 'org-1')).toBe(false);
  });

  it('a SUPERVISOR gets role permissions ∪ per-membership selected permissions', async () => {
    const { svc, orgRbac } = build({
      membership: { id: 'm1', roleKey: 'SUPERVISOR', status: 'ACTIVE' },
      rolePerms: [],
      supervisorPerms: ['member.read', 'member.update'],
    });
    expect(await svc.canInOrganization(principal(), 'member.update', 'org-1')).toBe(true);
    expect(await svc.canInOrganization(principal(), 'supervisor.assign', 'org-1')).toBe(false);
    expect(orgRbac.getSupervisorPermissionKeys).toHaveBeenCalledWith('m1');
  });

  it('non-SUPERVISOR memberships do not consult supervisor permissions', async () => {
    const { svc, orgRbac } = build({
      membership: { id: 'm1', roleKey: 'STAFF', status: 'ACTIVE' },
      rolePerms: ['organization.read'],
    });
    await svc.canInOrganization(principal(), 'organization.read', 'org-1');
    expect(orgRbac.getSupervisorPermissionKeys).not.toHaveBeenCalled();
  });
});
