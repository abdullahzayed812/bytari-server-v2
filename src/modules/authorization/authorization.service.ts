import type { Logger } from 'pino';
import { ForbiddenError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import { ADMIN_ROLE_KEY, SUPERVISOR_DOMAIN_PERMISSIONS } from '../rbac/rbac.constants.js';
import type { SupervisorDomain } from '../rbac/rbac.constants.js';
import type { PermissionRepository } from '../rbac/permission.repository.js';
import type { RoleRepository } from '../rbac/role.repository.js';
import type { SupervisorRepository } from '../supervisors/supervisor.repository.js';
import type { MembershipRepository } from '../organizations/infrastructure/membership.repository.js';
import type { OrganizationRbacRepository } from '../organizations/infrastructure/organization-rbac.repository.js';
import {
  OWNER_ORG_ROLE_KEY,
  SUPERVISOR_ORG_ROLE_KEY,
} from '../organizations/domain/organization-rbac.constants.js';
import type { AuthPrincipal } from './authorization.types.js';

/** Repositories the org-scoped authorization path needs. Injected in Phase 3. */
export interface OrganizationAuthzDeps {
  memberships: MembershipRepository;
  orgRbac: OrganizationRbacRepository;
}

export interface OrganizationMembershipContext {
  membershipId: string;
  roleKey: string;
  status: string;
  /** Effective org permission keys: role permissions ∪ (supervisor-selected, if SUPERVISOR). */
  permissions: string[];
  isOwner: boolean;
}

/**
 * Centralised permission evaluation — the ONLY place that decides "may this
 * principal do X". Controllers reach it via the `authorize()` /
 * `authorizeOrg()` middleware; services may call it directly.
 *
 * Global resolution order:
 *   1. ADMIN role  → full access (override; no permission rows required)
 *   2. otherwise    → union of permissions granted through the user's global roles
 *
 * Organization-scoped resolution order (`*InOrganization`):
 *   1. ADMIN role      → full access (global override still applies)
 *   2. no ACTIVE membership in that org → denied
 *   3. membership role OWNER            → full organization access (owner override)
 *   4. otherwise → org-role permissions ∪ (per-membership supervisor permissions)
 */
export class AuthorizationService {
  private readonly log: Logger;

  constructor(
    private readonly roles: RoleRepository,
    private readonly permissions: PermissionRepository,
    logger: Logger,
    private readonly orgDeps?: OrganizationAuthzDeps,
    /** System-supervisor assignments repo. Injected in Phase 7. */
    private readonly supervisors?: SupervisorRepository,
  ) {
    this.log = logger.child({ component: 'authorization' });
  }

  /**
   * Permissions the principal holds via an ACTIVE system-supervisor domain
   * assignment (docs 03 §3.10). Empty when the supervisor repo is not wired.
   */
  private async supervisorDomainPermissions(userId: string): Promise<Set<string>> {
    if (!this.supervisors) return new Set();
    const domains = await this.supervisors.getActiveDomainsForUser(userId);
    const out = new Set<string>();
    for (const d of domains) {
      for (const p of SUPERVISOR_DOMAIN_PERMISSIONS[d as SupervisorDomain] ?? []) out.add(p);
    }
    return out;
  }

  /** True when the principal actively supervises `domain` (or is ADMIN). */
  async isSystemSupervisorFor(
    principal: Pick<AuthPrincipal, 'roleKeys' | 'userId'>,
    domain: SupervisorDomain,
  ): Promise<boolean> {
    if (this.isAdmin(principal)) return true;
    if (!this.supervisors) return false;
    const domains = await this.supervisors.getActiveDomainsForUser(principal.userId);
    return domains.includes(domain);
  }

  // --- global -----------------------------------------------------------

  isAdmin(principal: Pick<AuthPrincipal, 'roleKeys'>): boolean {
    return principal.roleKeys.includes(ADMIN_ROLE_KEY);
  }

  /** All permission keys effectively held by the principal. ADMIN → every key. */
  async getEffectivePermissions(principal: AuthPrincipal): Promise<string[]> {
    if (this.isAdmin(principal)) return this.permissions.listKeys();
    const rolePerms = await this.roles.getPermissionKeysForUser(principal.userId);
    const supervisorPerms = await this.supervisorDomainPermissions(principal.userId);
    return [...new Set([...rolePerms, ...supervisorPerms])];
  }

  async can(principal: AuthPrincipal, permission: string): Promise<boolean> {
    if (this.isAdmin(principal)) return true;
    const held = await this.roles.getPermissionKeysForUser(principal.userId);
    if (held.includes(permission)) return true;
    // Fallback: a permission implied by an ACTIVE system-supervisor domain.
    return (await this.supervisorDomainPermissions(principal.userId)).has(permission);
  }

  /** Throws {@link ForbiddenError} unless the principal holds `permission`. */
  async assert(principal: AuthPrincipal, permission: string): Promise<void> {
    if (await this.can(principal, permission)) return;
    this.log.debug({ userId: principal.userId, permission }, 'permission denied');
    throw new ForbiddenError(`Missing required permission: ${permission}`, {
      code: ErrorCode.PERMISSION_DENIED,
    });
  }

  /** Require every listed permission. */
  async assertAll(principal: AuthPrincipal, perms: string[]): Promise<void> {
    if (this.isAdmin(principal)) return;
    const held = new Set(await this.roles.getPermissionKeysForUser(principal.userId));
    const missing = perms.filter((p) => !held.has(p));
    if (missing.length > 0) {
      throw new ForbiddenError(`Missing required permission: ${missing[0]}`, {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
  }

  isApprovedVeterinarian(
    principal: Pick<AuthPrincipal, 'roleKeys' | 'veterinarianStatus'>,
  ): boolean {
    return (
      principal.roleKeys.includes('VETERINARIAN') && principal.veterinarianStatus === 'APPROVED'
    );
  }

  /**
   * Gate for veterinarian-only capabilities. A user may hold the VETERINARIAN
   * role while their status is PENDING/REJECTED — they still get NO veterinarian
   * authorization until APPROVED.
   */
  assertApprovedVeterinarian(
    principal: Pick<AuthPrincipal, 'roleKeys' | 'veterinarianStatus'>,
  ): void {
    if (this.isApprovedVeterinarian(principal)) return;
    throw new ForbiddenError('Veterinarian access requires an approved veterinarian account', {
      code: ErrorCode.PERMISSION_DENIED,
    });
  }

  /**
   * Trader status is pure status — no role component (unlike veterinarian),
   * since the Poultry Markets spec never asked for a granted role.
   */
  isApprovedTrader(principal: Pick<AuthPrincipal, 'traderStatus'>): boolean {
    return principal.traderStatus === 'APPROVED';
  }

  /** Gate for trader-only market capabilities (create/manage offers). */
  assertApprovedTrader(principal: Pick<AuthPrincipal, 'traderStatus'>): void {
    if (this.isApprovedTrader(principal)) return;
    throw new ForbiddenError('This action requires an approved trader account', {
      code: ErrorCode.TRADER_APPROVAL_REQUIRED,
    });
  }

  // --- organization-scoped ------------------------------------------

  private orgOrThrow(): OrganizationAuthzDeps {
    if (!this.orgDeps) {
      throw new Error('AuthorizationService: organization dependencies are not configured');
    }
    return this.orgDeps;
  }

  /**
   * Resolve a user's effective context inside one organization, or `null` when
   * they have no ACTIVE membership there. ADMINs are NOT special-cased here —
   * callers apply the ADMIN override explicitly.
   */
  async getOrganizationMembershipContext(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembershipContext | null> {
    const { memberships, orgRbac } = this.orgOrThrow();
    const membership = await memberships.findByUserAndOrg(userId, organizationId);
    if (!membership || membership.status !== 'ACTIVE') return null;

    const isOwner = membership.roleKey === OWNER_ORG_ROLE_KEY;
    if (isOwner) {
      // The owner override makes the concrete permission list irrelevant.
      return {
        membershipId: membership.id,
        roleKey: membership.roleKey,
        status: membership.status,
        isOwner: true,
        permissions: [],
      };
    }

    const role = await orgRbac.findRoleByKey(membership.roleKey);
    const rolePerms = role ? await orgRbac.getPermissionKeysForRole(role.id) : [];
    const supervisorPerms =
      membership.roleKey === SUPERVISOR_ORG_ROLE_KEY
        ? await orgRbac.getSupervisorPermissionKeys(membership.id)
        : [];

    return {
      membershipId: membership.id,
      roleKey: membership.roleKey,
      status: membership.status,
      isOwner: false,
      permissions: [...new Set([...rolePerms, ...supervisorPerms])],
    };
  }

  async canInOrganization(
    principal: AuthPrincipal,
    permission: string,
    organizationId: string,
  ): Promise<boolean> {
    if (this.isAdmin(principal)) return true;
    const ctx = await this.getOrganizationMembershipContext(principal.userId, organizationId);
    if (!ctx) return false;
    if (ctx.isOwner) return true;
    return ctx.permissions.includes(permission);
  }

  async assertInOrganization(
    principal: AuthPrincipal,
    permission: string,
    organizationId: string,
  ): Promise<void> {
    if (await this.canInOrganization(principal, permission, organizationId)) return;
    this.log.debug(
      { userId: principal.userId, organizationId, permission },
      'organization permission denied',
    );
    throw new ForbiddenError(`Missing required organization permission: ${permission}`, {
      code: ErrorCode.PERMISSION_DENIED,
    });
  }
}
