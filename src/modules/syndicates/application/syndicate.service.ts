import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import { OWNER_ORG_ROLE_KEY } from '../../organizations/domain/organization-rbac.constants.js';
import type { OrganizationRbacRepository } from '../../organizations/infrastructure/organization-rbac.repository.js';
import type { OrganizationFollowRepository } from '../../organizations/infrastructure/organization-follow.repository.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import {
  SyndicateAuditAction,
  SyndicateAuditEntity,
  SyndicateEvent,
} from '../domain/syndicate.constants.js';
import { SyndicatePolicy } from '../domain/syndicate.policy.js';
import type {
  CreateSyndicateInput,
  MySyndicateAccessDTO,
  PublicSyndicateDTO,
  SyndicateBrowseFilter,
  SyndicateCountersDTO,
  UpdateSyndicateProfileInput,
} from '../domain/syndicate.types.js';
import type { SyndicateDetailsRepository } from '../infrastructure/syndicate-details.repository.js';
import type { SyndicateRegistrationRepository } from '../infrastructure/syndicate-registration.repository.js';
import type { SyndicateSubmissionRepository } from '../infrastructure/syndicate-submission.repository.js';
import type { SyndicateMedia } from './syndicate-media.js';

export interface SyndicateActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

/**
 * Veterinary Syndicates / Unions ("نقابة الأطباء البيطريين"). A syndicate is
 * an `organizations` row (`type = 'SYNDICATE'`) plus a `syndicate_details`
 * extension row — reusing the organization aggregate, its per-instance
 * membership/supervisor RBAC and follow feature as-is (see
 * `domain/syndicate.constants.ts`). Created by an ADMIN only — never
 * self-service — so it starts ACTIVE immediately.
 */
export class SyndicateService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly details: SyndicateDetailsRepository,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly orgRbac: OrganizationRbacRepository,
    private readonly follows: OrganizationFollowRepository,
    private readonly authz: AuthorizationService,
    private readonly media: SyndicateMedia,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
    private readonly registrations: SyndicateRegistrationRepository,
    private readonly submissions: SyndicateSubmissionRepository,
  ) {
    this.log = logger.child({ component: 'syndicate-service' });
  }

  /** Card counters, only for a viewer allowed to read this syndicate's submissions. */
  private async countersFor(
    organizationId: string,
    viewer: AuthPrincipal | null,
  ): Promise<SyndicateCountersDTO | null> {
    if (!viewer) return null;
    const allowed =
      this.authz.isAdmin(viewer) ||
      (await this.authz.canInOrganization(viewer, 'syndicate.submission.read', organizationId));
    return allowed ? this.submissions.countersFor(organizationId, viewer.userId) : null;
  }

  private async toPublicDTO(
    organizationId: string,
    viewer: AuthPrincipal | null,
  ): Promise<PublicSyndicateDTO> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'SYNDICATE') throw new NotFoundError('Syndicate not found');
    // A deleted (DEACTIVATED) / suspended syndicate disappears for everyone
    // but a global Admin.
    if (org.status !== 'ACTIVE' && !(viewer && this.authz.isAdmin(viewer))) {
      throw new NotFoundError('Syndicate not found');
    }
    const viewerUserId = viewer?.userId ?? null;
    const d = await this.details.findByOrganizationId(organizationId);

    const [branchCount, followersCount, isFollowing, registration, membersCount, counters] =
      await Promise.all([
        d && d.parentOrganizationId === null
          ? this.details.countBranches(organizationId)
          : Promise.resolve(0),
        this.follows.count(organizationId),
        viewerUserId
          ? this.follows.isFollowing(organizationId, viewerUserId)
          : Promise.resolve(false),
        viewerUserId
          ? this.registrations.findActive(organizationId, viewerUserId)
          : Promise.resolve(null),
        this.registrations.countActive(organizationId),
        this.countersFor(organizationId, viewer),
      ]);

    return {
      id: org.id,
      pinnedToHome: Boolean(d?.pinnedToHomeAt),
      parentOrganizationId: d?.parentOrganizationId ?? null,
      name: org.name,
      description: org.description,
      status: org.status,
      governorate: d?.governorate ?? null,
      address: d?.address ?? null,
      phone: d?.phone ?? null,
      email: d?.email ?? null,
      website: d?.website ?? null,
      logoUrl: await this.media.resolveUrl(d?.logoStorageKey ?? null),
      headOfficerName: d?.headOfficerName ?? null,
      headOfficerTitle: d?.headOfficerTitle ?? null,
      termStartYear: d?.termStartYear ?? null,
      termEndYear: d?.termEndYear ?? null,
      branchCount,
      isFollowing,
      followersCount,
      isRegistered: registration !== null,
      membersCount,
      counters,
      createdAt: org.createdAt,
    };
  }

  // --- create (ADMIN only) --------------------------------------------

  async create(input: CreateSyndicateInput, actor: SyndicateActor): Promise<PublicSyndicateDTO> {
    if (input.parentOrganizationId) {
      const parentOrg = await this.organizations.findById(input.parentOrganizationId);
      const parentDetails =
        parentOrg && parentOrg.type === 'SYNDICATE'
          ? await this.details.findByOrganizationId(parentOrg.id)
          : null;
      SyndicatePolicy.assertValidParent(
        input.parentOrganizationId,
        parentOrg
          ? {
              type: parentOrg.type,
              parentOrganizationId: parentDetails?.parentOrganizationId ?? null,
            }
          : null,
      );
    }

    const orgId = await this.db.transaction(async (tx) => {
      const ownerRole = await this.orgRbac.findRoleByKey(OWNER_ORG_ROLE_KEY, tx);
      if (!ownerRole) throw new Error('Seed data missing: organization role "OWNER"');

      const org = await this.organizations.create(
        {
          type: 'SYNDICATE',
          name: input.name,
          description: input.description ?? null,
          ownerUserId: actor.principal.userId,
        },
        tx,
      );
      // Admin-created — active immediately, no PENDING moderation queue.
      await this.organizations.updateStatus(
        org.id,
        { status: 'ACTIVE', decidedBy: actor.principal.userId },
        tx,
      );
      await this.details.create(org.id, input, tx);
      await this.memberships.create(
        {
          organizationId: org.id,
          userId: actor.principal.userId,
          organizationRoleId: ownerRole.id,
          status: 'ACTIVE',
          addedBy: actor.principal.userId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: SyndicateAuditAction.CREATED,
          entityType: SyndicateAuditEntity.SYNDICATE,
          entityId: org.id,
          actorUserId: actor.principal.userId,
          metadata: { name: org.name, parentOrganizationId: input.parentOrganizationId ?? null },
          context: actor.context,
        },
        tx,
      );
      return org.id;
    });

    this.events.publish(SyndicateEvent.CREATED, {
      organizationId: orgId,
      parentOrganizationId: input.parentOrganizationId ?? null,
      actorUserId: actor.principal.userId,
    });
    return this.toPublicDTO(orgId, actor.principal);
  }

  // --- reads -----------------------------------------------------

  async getPublic(
    organizationId: string,
    viewer: AuthPrincipal | null,
  ): Promise<PublicSyndicateDTO> {
    return this.toPublicDTO(organizationId, viewer);
  }

  /** Root (main) syndicates — the top-level "السقابة" browse/landing list. */
  async listMain(
    filter: SyndicateBrowseFilter,
    viewer: AuthPrincipal | null,
  ): Promise<{ items: PublicSyndicateDTO[]; total: number }> {
    const { ids, total } = await this.details.listMainOrganizationIds(filter);
    const items = await Promise.all(ids.map((id) => this.toPublicDTO(id, viewer)));
    return { items, total };
  }

  /** Subordinate/branch syndicates of one main syndicate — "فروع النقابة". */
  async listBranches(
    parentOrganizationId: string,
    filter: SyndicateBrowseFilter,
    viewer: AuthPrincipal | null,
  ): Promise<{ items: PublicSyndicateDTO[]; total: number }> {
    const { ids, total } = await this.details.listBranchOrganizationIds(
      parentOrganizationId,
      filter,
    );
    const items = await Promise.all(ids.map((id) => this.toPublicDTO(id, viewer)));
    return { items, total };
  }

  // --- profile management (syndicate.profile.manage, org-scoped) --------

  async updateProfile(
    organizationId: string,
    patch: UpdateSyndicateProfileInput,
    actor: SyndicateActor,
  ): Promise<PublicSyndicateDTO> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'SYNDICATE') throw new NotFoundError('Syndicate not found');

    const logoStorageKey =
      patch.logoStorageKey !== undefined
        ? await this.media.validateKey('LOGO', patch.logoStorageKey)
        : undefined;
    const previousLogoKey =
      logoStorageKey !== undefined
        ? ((await this.details.findByOrganizationId(organizationId))?.logoStorageKey ?? null)
        : null;

    await this.db.transaction(async (tx) => {
      if (patch.name !== undefined || patch.description !== undefined) {
        await this.organizations.update(
          organizationId,
          { name: patch.name, description: patch.description },
          tx,
        );
      }
      await this.details.update(organizationId, { ...patch, logoStorageKey }, tx);
      await this.audit.record(
        {
          action: SyndicateAuditAction.PROFILE_UPDATED,
          entityType: SyndicateAuditEntity.SYNDICATE,
          entityId: organizationId,
          actorUserId: actor.principal.userId,
          metadata: { fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
    });

    // The replaced logo is orphaned in R2 — clean up after commit.
    if (logoStorageKey !== undefined) {
      await this.media.deleteReplaced([previousLogoKey], [logoStorageKey], { organizationId });
    }

    return this.toPublicDTO(organizationId, actor.principal);
  }

  /**
   * Delete a syndicate (global Admin, `syndicate.admin.delete`). Follows the
   * organizations convention — a soft delete: the organization becomes
   * DEACTIVATED (hidden from browse, every org-scoped write refused by
   * `authorizeOrg`) and every ACTIVE registration is ended as REMOVED, in one
   * transaction. Announcements / submissions / media stay attached to the
   * (deactivated) organization row, so nothing is orphaned and history and
   * audit survive. A main syndicate with active branches must have its
   * branches deleted first.
   */
  async delete(organizationId: string, actor: SyndicateActor): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'SYNDICATE') throw new NotFoundError('Syndicate not found');
    if (org.status === 'DEACTIVATED') return;
    const activeBranches = await this.details.countActiveBranches(organizationId);
    if (activeBranches > 0) {
      throw new ConflictError('Delete this syndicate’s branches first', {
        code: ErrorCode.SYNDICATE_HAS_BRANCHES,
      });
    }

    await this.db.transaction(async (tx) => {
      await this.organizations.updateStatus(organizationId, { status: 'DEACTIVATED' }, tx);
      const endedRegistrations = await this.registrations.endAllForOrganization(
        organizationId,
        actor.principal.userId,
        tx,
      );
      await this.audit.record(
        {
          action: SyndicateAuditAction.DELETED,
          entityType: SyndicateAuditEntity.SYNDICATE,
          entityId: organizationId,
          actorUserId: actor.principal.userId,
          metadata: { name: org.name, from: org.status, endedRegistrations },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish(SyndicateEvent.DELETED, {
      organizationId,
      actorUserId: actor.principal.userId,
    });
  }

  // --- pin to Veterinarian Home (syndicate.admin.pin; route-authorized) --

  async setPinnedToHome(
    organizationId: string,
    pinned: boolean,
    actor: SyndicateActor,
  ): Promise<PublicSyndicateDTO> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'SYNDICATE') throw new NotFoundError('Syndicate not found');
    if (pinned && org.status !== 'ACTIVE') {
      throw new ConflictError('Only an active syndicate can be pinned to the Home page', {
        code: ErrorCode.CONFLICT,
      });
    }
    await this.db.transaction(async (tx) => {
      await this.details.setPinnedToHome(organizationId, pinned, tx);
      await this.audit.record(
        {
          action: pinned
            ? SyndicateAuditAction.PINNED_TO_HOME
            : SyndicateAuditAction.UNPINNED_FROM_HOME,
          entityType: SyndicateAuditEntity.SYNDICATE,
          entityId: organizationId,
          actorUserId: actor.principal.userId,
          metadata: { name: org.name },
          context: actor.context,
        },
        tx,
      );
    });
    return this.toPublicDTO(organizationId, actor.principal);
  }

  /** "النقابات المثبتة" — bottom of the Veterinarian Home. */
  async listPinned(viewer: AuthPrincipal): Promise<PublicSyndicateDTO[]> {
    const ids = await this.details.listPinnedOrganizationIds(20);
    return Promise.all(ids.map((id) => this.toPublicDTO(id, viewer)));
  }

  /** Internal — used by the announcement/submission services to load org context. */
  async loadOrganizationContext(
    organizationId: string,
  ): Promise<{ id: string; name: string; type: string } | null> {
    const org = await this.organizations.findById(organizationId);
    return org ? { id: org.id, name: org.name, type: org.type } : null;
  }

  /** "What can I do here?" — drives whether the mobile app shows management actions for this syndicate. */
  async getMyAccess(
    organizationId: string,
    principal: AuthPrincipal,
  ): Promise<MySyndicateAccessDTO> {
    const isAdmin = this.authz.isAdmin(principal);
    const ctx = isAdmin
      ? null
      : await this.authz.getOrganizationMembershipContext(principal.userId, organizationId);
    const isOwner = ctx?.isOwner ?? false;
    const has = (permission: string): boolean =>
      isAdmin || isOwner || (ctx?.permissions.includes(permission) ?? false);
    const registration = await this.registrations.findActive(organizationId, principal.userId);
    return {
      isAdmin,
      isOwner,
      canManageProfile: has('syndicate.profile.manage'),
      canManageAnnouncements: has('syndicate.announcement.manage'),
      canReadSubmissions: has('syndicate.submission.read'),
      canRespondSubmissions: has('syndicate.submission.respond'),
      canReadMembers: has('syndicate.member.read'),
      canManageMembers: has('syndicate.member.manage'),
      canMessageMembers: has('syndicate.member.message'),
      canDelete: isAdmin,
      isRegistered: registration !== null,
    };
  }
}
