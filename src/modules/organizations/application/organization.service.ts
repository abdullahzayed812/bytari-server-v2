import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, InternalError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import { OrganizationPolicy } from '../domain/organization.policy.js';
import { OWNER_ORG_ROLE_KEY } from '../domain/organization-rbac.constants.js';
import type {
  Organization,
  OrganizationStatus,
  OrganizationType,
  OrganizationWithDetails,
} from '../domain/organization.types.js';
import type { MembershipRepository } from '../infrastructure/membership.repository.js';
import type { OrganizationRbacRepository } from '../infrastructure/organization-rbac.repository.js';
import type {
  ListOrganizationsFilter,
  OrganizationRepository,
} from '../infrastructure/organization.repository.js';

export interface OrgActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface CreateOrganizationInput {
  type: OrganizationType;
  name: string;
  description?: string | null;
}

const NON_ADMIN_STATUS_CHANGE: Record<
  'suspend' | 'activate' | 'deactivate',
  { to: OrganizationStatus; from: OrganizationStatus[]; action: string; event: string }
> = {
  suspend: {
    to: 'SUSPENDED',
    from: ['ACTIVE', 'SUSPENDED'],
    action: AuditAction.ORGANIZATION_SUSPENDED,
    event: 'organization.suspended',
  },
  activate: {
    to: 'ACTIVE',
    from: ['SUSPENDED', 'DEACTIVATED', 'ACTIVE'],
    action: AuditAction.ORGANIZATION_ACTIVATED,
    event: 'organization.activated',
  },
  deactivate: {
    to: 'DEACTIVATED',
    from: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'],
    action: AuditAction.ORGANIZATION_DEACTIVATED,
    event: 'organization.deactivated',
  },
};

/**
 * Common organization lifecycle: creation (→ PENDING), admin approval/rejection,
 * admin status changes, and reads. Type-specific rules live in
 * {@link OrganizationPolicy} — never inlined here.
 */
export class OrganizationService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly orgRbac: OrganizationRbacRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'organization-service' });
  }

  async create(input: CreateOrganizationInput, actor: OrgActor): Promise<OrganizationWithDetails> {
    const creator = await this.users.getById(actor.actorUserId);
    OrganizationPolicy.assertCanCreate(input.type, creator);
    OrganizationPolicy.validateTypeSpecificRules(input.type, input);

    const org = await this.db.transaction(async (tx) => {
      const ownerRole = await this.orgRbac.findRoleByKey(OWNER_ORG_ROLE_KEY, tx);
      if (!ownerRole) throw new InternalError('Seed data missing: organization role "OWNER"');

      const created = await this.organizations.create(
        {
          type: input.type,
          name: input.name,
          description: input.description ?? null,
          ownerUserId: actor.actorUserId,
        },
        tx,
      );

      const detailExtra = OrganizationPolicy.hasJoinCode(input.type)
        ? { join_code: OrganizationPolicy.generateJoinCode() }
        : {};
      await this.organizations.insertDetails(input.type, created.id, detailExtra, tx);

      const membership = await this.memberships.create(
        {
          organizationId: created.id,
          userId: actor.actorUserId,
          organizationRoleId: ownerRole.id,
          status: 'ACTIVE',
          addedBy: actor.actorUserId,
        },
        tx,
      );

      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_CREATED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { type: created.type, name: created.name },
          context: actor.context,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_MEMBER_ADDED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: membership.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: created.id, userId: actor.actorUserId, roleKey: 'OWNER' },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('organization.created', {
      organizationId: org.id,
      type: org.type,
      ownerUserId: org.ownerUserId,
    });

    const withDetails = await this.organizations.findByIdWithDetails(org.id);
    if (!withDetails) throw new InternalError('organization vanished after creation');
    return withDetails;
  }

  getWithDetails(id: string): Promise<OrganizationWithDetails | null> {
    return this.organizations.findByIdWithDetails(id);
  }

  async updateProfile(
    id: string,
    patch: { name?: string; description?: string | null },
    actor: OrgActor,
  ): Promise<OrganizationWithDetails> {
    await this.db.transaction(async (tx) => {
      await this.organizations.update(id, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_UPDATED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
    });
    const withDetails = await this.organizations.findByIdWithDetails(id);
    if (!withDetails) throw new InternalError('organization vanished after update');
    return withDetails;
  }

  async getById(id: string): Promise<Organization> {
    const org = await this.organizations.findById(id);
    if (!org) throw new NotFoundError('Organization not found');
    return org;
  }

  listForAdmin(filter: ListOrganizationsFilter): Promise<{ items: Organization[]; total: number }> {
    return this.organizations.list(filter);
  }

  listPendingForAdmin(
    page: number,
    pageSize: number,
  ): Promise<{ items: Organization[]; total: number }> {
    return this.organizations.list({ page, pageSize, status: 'PENDING' });
  }

  /** Organizations the user is an ACTIVE member of, with their org role in each. */
  async listMine(userId: string): Promise<Array<Organization & { myRole: string }>> {
    const memberships = await this.memberships.listActiveOrganizationsForUser(userId);
    if (memberships.length === 0) return [];
    const roleByOrg = new Map(memberships.map((m) => [m.organizationId, m.roleKey]));
    const orgs = await this.organizations.findManyByIds([...roleByOrg.keys()]);
    return orgs.map((o) => ({ ...o, myRole: roleByOrg.get(o.id) ?? 'STAFF' }));
  }

  async approve(id: string, actor: OrgActor): Promise<Organization> {
    const org = await this.getById(id);
    if (org.status !== 'PENDING') {
      throw new ConflictError('Only a pending organization can be approved');
    }
    const updated = await this.db.transaction(async (tx) => {
      const u = await this.organizations.updateStatus(
        id,
        { status: 'ACTIVE', decidedBy: actor.actorUserId, decisionReason: null },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_APPROVED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { type: org.type },
          context: actor.context,
        },
        tx,
      );
      return u;
    });
    this.events.publish('organization.approved', {
      organizationId: id,
      ownerUserId: org.ownerUserId,
    });
    return updated;
  }

  async reject(id: string, reason: string, actor: OrgActor): Promise<Organization> {
    const org = await this.getById(id);
    if (org.status !== 'PENDING') {
      throw new ConflictError('Only a pending organization can be rejected');
    }
    const updated = await this.db.transaction(async (tx) => {
      const u = await this.organizations.updateStatus(
        id,
        { status: 'REJECTED', decidedBy: actor.actorUserId, decisionReason: reason },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_REJECTED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { type: org.type, reason },
          context: actor.context,
        },
        tx,
      );
      return u;
    });
    this.events.publish('organization.rejected', {
      organizationId: id,
      ownerUserId: org.ownerUserId,
    });
    return updated;
  }

  async changeStatus(
    id: string,
    op: 'suspend' | 'activate' | 'deactivate',
    actor: OrgActor,
    reason?: string,
  ): Promise<Organization> {
    const org = await this.getById(id);
    if (org.status === 'PENDING' || org.status === 'REJECTED') {
      throw new ConflictError(
        'Use approve/reject for a pending organization; status changes apply to reviewed organizations only',
      );
    }
    const rule = NON_ADMIN_STATUS_CHANGE[op];
    if (!rule.from.includes(org.status)) {
      throw new ConflictError(`Cannot ${op} an organization in status ${org.status}`);
    }

    const updated = await this.db.transaction(async (tx) => {
      const u = await this.organizations.updateStatus(id, { status: rule.to }, tx);
      await this.audit.record(
        {
          action: rule.action,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { from: org.status, to: rule.to, reason: reason ?? null },
          context: actor.context,
        },
        tx,
      );
      return u;
    });
    this.events.publish(rule.event, { organizationId: id, ownerUserId: org.ownerUserId });
    return updated;
  }
}
