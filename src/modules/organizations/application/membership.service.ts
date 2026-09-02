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
import type {
  MembershipStatus,
  OrganizationMembershipSummary,
} from '../domain/organization.types.js';
import type {
  ListMembersFilter,
  MembershipRepository,
} from '../infrastructure/membership.repository.js';
import type { OrganizationRbacRepository } from '../infrastructure/organization-rbac.repository.js';

export interface MemberActor {
  actorUserId: string;
  context?: AuditContext;
}

/** Org roles that can be granted via the generic member-management routes. */
const ASSIGNABLE_MEMBER_ROLES = new Set(['VETERINARIAN', 'STAFF']);

export class MembershipService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly memberships: MembershipRepository,
    private readonly orgRbac: OrganizationRbacRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'membership-service' });
  }

  list(
    organizationId: string,
    filter: ListMembersFilter,
  ): Promise<{ items: OrganizationMembershipSummary[]; total: number }> {
    return this.memberships.listForOrg(organizationId, filter);
  }

  /** Public-safe ACTIVE veterinarian roster — any authenticated user, not just members. */
  listPublicVeterinarians(
    organizationId: string,
  ): Promise<Array<{ id: string; firstName: string; lastName: string }>> {
    return this.memberships.listPublicVeterinarians(organizationId);
  }

  async getMember(
    organizationId: string,
    membershipId: string,
  ): Promise<OrganizationMembershipSummary> {
    const summary = await this.memberships.findSummaryByIdInOrg(membershipId, organizationId);
    if (!summary) throw new NotFoundError('Membership not found in this organization');
    return summary;
  }

  private async hydrate(
    membershipId: string,
    organizationId: string,
  ): Promise<OrganizationMembershipSummary> {
    const found = await this.memberships.findSummaryByIdInOrg(membershipId, organizationId);
    if (!found) throw new NotFoundError('Membership not found in this organization');
    return found;
  }

  async addMember(
    organizationId: string,
    input: { userId: string; roleKey: string },
    actor: MemberActor,
  ): Promise<OrganizationMembershipSummary> {
    if (!ASSIGNABLE_MEMBER_ROLES.has(input.roleKey)) {
      throw new BadRequestError('Members may only be added as VETERINARIAN or STAFF');
    }
    const target = await this.users.getById(input.userId);
    if (target.status !== 'ACTIVE') {
      throw new ConflictError('Cannot add a non-active account as a member');
    }
    OrganizationPolicy.assertCanHoldRole(input.roleKey, target);

    const membershipId = await this.db.transaction(async (tx) => {
      const orgRole = await this.orgRbac.findRoleByKey(input.roleKey, tx);
      if (!orgRole)
        throw new InternalError(`Seed data missing: organization role "${input.roleKey}"`);

      const existing = await this.memberships.findByUserAndOrg(input.userId, organizationId, tx);
      let id: string;
      if (existing && existing.status === 'ACTIVE') {
        throw new ConflictError('User is already an active member of this organization');
      } else if (existing) {
        const m = await this.memberships.update(
          existing.id,
          { organizationRoleId: orgRole.id, status: 'ACTIVE', addedBy: actor.actorUserId },
          tx,
        );
        id = m.id;
      } else {
        const m = await this.memberships.create(
          {
            organizationId,
            userId: input.userId,
            organizationRoleId: orgRole.id,
            status: 'ACTIVE',
            addedBy: actor.actorUserId,
          },
          tx,
        );
        id = m.id;
      }

      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_MEMBER_ADDED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, userId: input.userId, roleKey: input.roleKey },
          context: actor.context,
        },
        tx,
      );
      return id;
    });

    this.events.publish('organization.member.added', {
      organizationId,
      userId: input.userId,
      roleKey: input.roleKey,
    });
    return this.hydrate(membershipId, organizationId);
  }

  async updateMember(
    organizationId: string,
    membershipId: string,
    patch: { roleKey?: string; status?: 'ACTIVE' | 'SUSPENDED' },
    actor: MemberActor,
  ): Promise<OrganizationMembershipSummary> {
    const membership = await this.memberships.findByIdInOrg(membershipId, organizationId);
    if (!membership) throw new NotFoundError('Membership not found in this organization');
    if (membership.roleKey === 'OWNER') {
      throw new ForbiddenError('The owner membership cannot be modified');
    }
    if (patch.roleKey && !ASSIGNABLE_MEMBER_ROLES.has(patch.roleKey)) {
      throw new BadRequestError('Members may only be set to VETERINARIAN or STAFF');
    }

    await this.db.transaction(async (tx) => {
      const dbPatch: { organizationRoleId?: string; status?: MembershipStatus } = {};
      if (patch.roleKey) {
        const target = await this.users.getById(membership.userId, tx);
        OrganizationPolicy.assertCanHoldRole(patch.roleKey, target);
        const role = await this.orgRbac.findRoleByKey(patch.roleKey, tx);
        if (!role)
          throw new InternalError(`Seed data missing: organization role "${patch.roleKey}"`);
        dbPatch.organizationRoleId = role.id;
      }
      if (patch.status) dbPatch.status = patch.status;

      await this.memberships.update(membershipId, dbPatch, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_MEMBER_UPDATED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: membershipId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, changes: patch },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('organization.member.updated', { organizationId, membershipId });
    return this.hydrate(membershipId, organizationId);
  }

  async removeMember(
    organizationId: string,
    membershipId: string,
    actor: MemberActor,
  ): Promise<void> {
    const membership = await this.memberships.findByIdInOrg(membershipId, organizationId);
    if (!membership) throw new NotFoundError('Membership not found in this organization');
    if (membership.roleKey === 'OWNER') {
      throw new ForbiddenError('The organization owner cannot be removed');
    }
    if (membership.status === 'REMOVED') return;

    await this.db.transaction(async (tx) => {
      await this.memberships.update(membershipId, { status: 'REMOVED' }, tx);
      await this.orgRbac.clearSupervisorPermissions(membershipId, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_MEMBER_REMOVED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: membershipId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, userId: membership.userId, roleKey: membership.roleKey },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('organization.member.removed', {
      organizationId,
      userId: membership.userId,
    });
  }

  /** The authenticated user leaves an organization. Owners cannot leave (spec §20). */
  async leave(organizationId: string, userId: string, context?: AuditContext): Promise<void> {
    const membership = await this.memberships.findByUserAndOrg(userId, organizationId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new NotFoundError('You are not an active member of this organization');
    }
    if (membership.roleKey === 'OWNER') {
      throw new ConflictError(
        'The owner cannot leave the organization; transfer ownership first (not available yet)',
      );
    }

    await this.db.transaction(async (tx) => {
      await this.memberships.update(membership.id, { status: 'LEFT' }, tx);
      await this.orgRbac.clearSupervisorPermissions(membership.id, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_MEMBER_REMOVED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: membership.id,
          actorUserId: userId,
          metadata: { organizationId, userId, reason: 'left' },
          context,
        },
        tx,
      );
    });

    this.events.publish('organization.member.removed', {
      organizationId,
      userId,
      reason: 'left',
    });
  }
}
