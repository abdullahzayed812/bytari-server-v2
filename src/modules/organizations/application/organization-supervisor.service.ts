import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import { OrganizationPolicy } from '../domain/organization.policy.js';
import {
  isOrgPermissionKey,
  SUPERVISOR_ORG_ROLE_KEY,
} from '../domain/organization-rbac.constants.js';
import type { SupervisorMembershipSummary } from '../domain/organization.types.js';
import type { MembershipRepository } from '../infrastructure/membership.repository.js';
import type { OrganizationRbacRepository } from '../infrastructure/organization-rbac.repository.js';
import type { OrganizationRepository } from '../infrastructure/organization.repository.js';

export interface SupervisorActor {
  actorUserId: string;
  context?: AuditContext;
}

function assertValidPermissions(permissions: string[]): void {
  const invalid = permissions.filter((p) => !isOrgPermissionKey(p));
  if (invalid.length > 0) {
    throw new BadRequestError(`Unknown organization permission(s): ${invalid.join(', ')}`);
  }
}

/**
 * Organization-scoped supervisor management. A supervisor is a globally APPROVED
 * veterinarian granted an explicitly-selected set of organization permissions
 * (stored per-membership in `organization_supervisor_permissions`).
 */
export class OrganizationSupervisorService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly memberships: MembershipRepository,
    private readonly orgRbac: OrganizationRbacRepository,
    private readonly organizations: OrganizationRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'organization-supervisor-service' });
  }

  async list(organizationId: string): Promise<SupervisorMembershipSummary[]> {
    const supervisors = await this.memberships.listSupervisors(organizationId);
    return Promise.all(
      supervisors.map(async (s) => ({
        ...s,
        permissions: await this.orgRbac.getSupervisorPermissionKeys(s.id),
      })),
    );
  }

  async assign(
    organizationId: string,
    input: { userId: string; permissions: string[] },
    actor: SupervisorActor,
  ): Promise<SupervisorMembershipSummary> {
    if (input.userId === actor.actorUserId) {
      throw new ForbiddenError('You cannot assign yourself as an organization supervisor');
    }
    assertValidPermissions(input.permissions);

    const org = await this.organizations.findById(organizationId);
    if (!org) throw new NotFoundError('Organization not found');
    if (input.userId === org.ownerUserId) {
      throw new ForbiddenError('The owner cannot also be a supervisor of their own organization');
    }

    const target = await this.users.getById(input.userId);
    if (target.status !== 'ACTIVE') {
      throw new ConflictError('Cannot assign a non-active account as a supervisor');
    }
    OrganizationPolicy.assertCanBeSupervisor(target);

    const membershipId = await this.db.transaction(async (tx) => {
      const supRole = await this.orgRbac.findRoleByKey(SUPERVISOR_ORG_ROLE_KEY, tx);
      if (!supRole) throw new InternalError('Seed data missing: organization role "SUPERVISOR"');

      const existing = await this.memberships.findByUserAndOrg(input.userId, organizationId, tx);
      let id: string;
      if (existing && existing.roleKey === 'SUPERVISOR' && existing.status === 'ACTIVE') {
        throw new ConflictError('User is already an active supervisor of this organization');
      } else if (existing) {
        const m = await this.memberships.update(
          existing.id,
          { organizationRoleId: supRole.id, status: 'ACTIVE', addedBy: actor.actorUserId },
          tx,
        );
        id = m.id;
      } else {
        const m = await this.memberships.create(
          {
            organizationId,
            userId: input.userId,
            organizationRoleId: supRole.id,
            status: 'ACTIVE',
            addedBy: actor.actorUserId,
          },
          tx,
        );
        id = m.id;
      }

      const permIds = await this.orgRbac.findPermissionIdsByKeys(input.permissions, tx);
      await this.orgRbac.replaceSupervisorPermissions(id, [...permIds.values()], tx);

      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_SUPERVISOR_ASSIGNED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, userId: input.userId, permissions: input.permissions },
          context: actor.context,
        },
        tx,
      );
      return id;
    });

    this.events.publish('organization.supervisor.assigned', {
      organizationId,
      userId: input.userId,
      membershipId,
    });
    return this.hydrate(membershipId, organizationId);
  }

  async updatePermissions(
    organizationId: string,
    membershipId: string,
    permissions: string[],
    actor: SupervisorActor,
  ): Promise<SupervisorMembershipSummary> {
    assertValidPermissions(permissions);
    const membership = await this.memberships.findByIdInOrg(membershipId, organizationId);
    if (!membership)
      throw new NotFoundError('Supervisor membership not found in this organization');
    if (membership.roleKey !== 'SUPERVISOR' || membership.status !== 'ACTIVE') {
      throw new BadRequestError('That membership is not an active supervisor');
    }

    await this.db.transaction(async (tx) => {
      const permIds = await this.orgRbac.findPermissionIdsByKeys(permissions, tx);
      await this.orgRbac.replaceSupervisorPermissions(membershipId, [...permIds.values()], tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_SUPERVISOR_UPDATED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: membershipId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, permissions },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('organization.supervisor.updated', { organizationId, membershipId });
    return this.hydrate(membershipId, organizationId);
  }

  async remove(
    organizationId: string,
    membershipId: string,
    actor: SupervisorActor,
  ): Promise<void> {
    const membership = await this.memberships.findByIdInOrg(membershipId, organizationId);
    if (!membership)
      throw new NotFoundError('Supervisor membership not found in this organization');
    if (membership.roleKey !== 'SUPERVISOR') {
      throw new BadRequestError('That membership is not a supervisor');
    }
    if (membership.status === 'REMOVED') return;

    await this.db.transaction(async (tx) => {
      await this.memberships.update(membershipId, { status: 'REMOVED' }, tx);
      await this.orgRbac.clearSupervisorPermissions(membershipId, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_SUPERVISOR_REMOVED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: membershipId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, userId: membership.userId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('organization.supervisor.removed', {
      organizationId,
      userId: membership.userId,
    });
  }

  private async hydrate(
    membershipId: string,
    organizationId: string,
  ): Promise<SupervisorMembershipSummary> {
    const summary = await this.memberships.findSummaryByIdInOrg(membershipId, organizationId);
    if (!summary) throw new InternalError('supervisor membership vanished');
    return {
      ...summary,
      permissions: await this.orgRbac.getSupervisorPermissionKeys(membershipId),
    };
  }
}
