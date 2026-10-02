import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { ChatService } from '../../chat/application/chat.service.js';
import type { ConversationDTO } from '../../chat/domain/chat.types.js';
import type { BroadcastImagePresign } from '../../../shared/storage/broadcast-media.js';
import type { OrganizationBroadcastService } from '../../organizations/application/organization-broadcast.service.js';
import type { OrganizationSupervisorService } from '../../organizations/application/organization-supervisor.service.js';
import type { SupervisorMembershipSummary } from '../../organizations/domain/organization.types.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type { UserService } from '../../users/user.service.js';
import {
  SYNDICATE_ADMIN_PERMISSION_KEYS,
  SyndicateAuditAction,
  SyndicateAuditEntity,
  SyndicateEvent,
} from '../domain/syndicate.constants.js';
import type { MySyndicateRegistrationDTO, SyndicateMemberDTO } from '../domain/syndicate.types.js';
import type {
  SyndicateRegistration,
  SyndicateRegistrationRepository,
  SyndicateRegistrationWithUser,
} from '../infrastructure/syndicate-registration.repository.js';
import type { SyndicateActor } from './syndicate.service.js';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * Syndicate registration ("التسجيل في النقابة") and member administration.
 *
 * Registration is self-service and immediate — a row in
 * `syndicate_registrations`, deliberately separate from
 * `organization_memberships` (which, for a syndicate, holds only its officers:
 * OWNER + SUPERVISOR). Admin-side operations are reached only after the
 * route's `authorizeOrg('syndicate.member.*')` guard, so they are always scoped
 * to the one syndicate in the URL — a syndicate admin can never read or
 * message another syndicate's members.
 *
 * Reuses, never duplicates: one-to-one messages go through the existing chat
 * (`ChatService.getOrCreateSyndicateMember`), the "message all members"
 * broadcast through `OrganizationBroadcastService` (audience
 * `SYNDICATE_MEMBERS`), and syndicate-admin assignment through
 * `OrganizationSupervisorService` with the fixed syndicate permission set.
 */
export class SyndicateMemberService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly registrations: SyndicateRegistrationRepository,
    private readonly organizations: OrganizationRepository,
    private readonly users: UserService,
    private readonly chat: ChatService,
    private readonly broadcasts: OrganizationBroadcastService,
    private readonly supervisors: OrganizationSupervisorService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'syndicate-member-service' });
  }

  private async requireActiveSyndicate(organizationId: string): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'SYNDICATE' || org.status !== 'ACTIVE') {
      throw new NotFoundError('Syndicate not found');
    }
  }

  private async toMemberDTO(r: SyndicateRegistrationWithUser): Promise<SyndicateMemberDTO> {
    const user = await this.users.getByIdOrNull(r.userId);
    return {
      registrationId: r.id,
      userId: r.userId,
      firstName: r.firstName,
      lastName: r.lastName,
      avatarUrl: user ? await this.users.resolveAvatarUrl(user) : null,
      email: r.email,
      phone: r.phone,
      country: r.country,
      governorate: r.governorate,
      specialization: r.specialization,
      isVeterinarian: r.veterinarianStatus === 'APPROVED',
      status: r.status,
      registeredAt: r.registeredAt.toISOString(),
    };
  }

  private toMine(r: SyndicateRegistration): MySyndicateRegistrationDTO {
    return {
      registrationId: r.id,
      organizationId: r.organizationId,
      status: r.status,
      registeredAt: r.registeredAt.toISOString(),
    };
  }

  // --- self-service (any authenticated user) ---------------------------

  async register(
    organizationId: string,
    actor: SyndicateActor,
  ): Promise<MySyndicateRegistrationDTO> {
    await this.requireActiveSyndicate(organizationId);
    const userId = actor.principal.userId;
    const user = await this.users.getById(userId);
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError('Your account must be active to register with a syndicate');
    }
    const existing = await this.registrations.findActive(organizationId, userId);
    if (existing) {
      throw new ConflictError('You are already registered with this syndicate', {
        code: ErrorCode.SYNDICATE_ALREADY_REGISTERED,
      });
    }

    let created: SyndicateRegistration;
    try {
      created = await this.db.transaction(async (tx) => {
        const r = await this.registrations.create(organizationId, userId, tx);
        await this.audit.record(
          {
            action: SyndicateAuditAction.MEMBER_REGISTERED,
            entityType: SyndicateAuditEntity.REGISTRATION,
            entityId: r.id,
            actorUserId: userId,
            metadata: { organizationId },
            context: actor.context,
          },
          tx,
        );
        return r;
      });
    } catch (err) {
      // A concurrent double-tap loses the race on the partial unique index.
      if (isUniqueViolation(err)) {
        throw new ConflictError('You are already registered with this syndicate', {
          code: ErrorCode.SYNDICATE_ALREADY_REGISTERED,
        });
      }
      throw err;
    }

    this.events.publish(SyndicateEvent.MEMBER_REGISTERED, {
      organizationId,
      registrationId: created.id,
      userId,
    });
    return this.toMine(created);
  }

  async getMine(
    organizationId: string,
    userId: string,
  ): Promise<MySyndicateRegistrationDTO | null> {
    const r = await this.registrations.findActive(organizationId, userId);
    return r ? this.toMine(r) : null;
  }

  async cancelMine(organizationId: string, actor: SyndicateActor): Promise<void> {
    const r = await this.registrations.findActive(organizationId, actor.principal.userId);
    if (!r) throw new NotFoundError('You are not registered with this syndicate');
    await this.endRegistration(r, 'CANCELLED', actor);
  }

  // --- syndicate admin (syndicate.member.*, org-scoped) ---------------

  async listMembers(
    organizationId: string,
    filter: { search?: string; page: number; pageSize: number },
  ): Promise<{ items: SyndicateMemberDTO[]; total: number }> {
    const { items, total } = await this.registrations.listActiveWithUsers(organizationId, filter);
    return { items: await Promise.all(items.map((r) => this.toMemberDTO(r))), total };
  }

  async getMember(organizationId: string, userId: string): Promise<SyndicateMemberDTO> {
    const r = await this.registrations.findActiveWithUser(organizationId, userId);
    if (!r) throw new NotFoundError('Member not found');
    return this.toMemberDTO(r);
  }

  async removeMember(organizationId: string, userId: string, actor: SyndicateActor): Promise<void> {
    const r = await this.registrations.findActive(organizationId, userId);
    if (!r) throw new NotFoundError('Member not found');
    await this.endRegistration(r, 'REMOVED', actor);
  }

  /** "مراسلة" — open (or reuse) the one-to-one SYNDICATE_MEMBER chat with a registered member. */
  async openConversation(
    organizationId: string,
    memberUserId: string,
    actor: SyndicateActor,
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    await this.requireActiveSyndicate(organizationId);
    const r = await this.registrations.findActive(organizationId, memberUserId);
    if (!r) throw new NotFoundError('Member not found');
    if (memberUserId === actor.principal.userId) {
      throw new BadRequestError('You cannot open a conversation with yourself');
    }
    return this.chat.getOrCreateSyndicateMember(
      { actorUserId: actor.principal.userId, context: actor.context },
      organizationId,
      memberUserId,
    );
  }

  /** Presigned PUT for the optional photo of a members broadcast. */
  async requestBroadcastImageUploadUrl(
    organizationId: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<BroadcastImagePresign> {
    await this.requireActiveSyndicate(organizationId);
    return this.broadcasts.requestImageUploadUrl(organizationId, input);
  }

  /** "رسالة إلى الأعضاء" — notify every ACTIVE registered member of THIS syndicate. */
  async messageAllMembers(
    organizationId: string,
    input: {
      title: string;
      body: string;
      clientRequestId: string;
      imageStorageKey?: string | null;
      linkUrl?: string | null;
    },
    actor: SyndicateActor,
  ): Promise<{ broadcastId: string; recipientCount: number }> {
    await this.requireActiveSyndicate(organizationId);
    const recipientCount = await this.registrations.countActive(organizationId);
    if (recipientCount === 0) {
      throw new ConflictError('This syndicate has no registered members to message', {
        code: ErrorCode.SYNDICATE_NO_MEMBERS,
      });
    }
    const { broadcastId } = await this.broadcasts.send(
      organizationId,
      {
        title: input.title,
        body: input.body,
        imageStorageKey: input.imageStorageKey ?? null,
        linkUrl: input.linkUrl ?? null,
      },
      { actorUserId: actor.principal.userId, context: actor.context },
      { audience: 'SYNDICATE_MEMBERS', idempotencyKey: input.clientRequestId },
    );
    await this.audit.record({
      action: SyndicateAuditAction.MEMBERS_MESSAGED,
      entityType: SyndicateAuditEntity.SYNDICATE,
      entityId: organizationId,
      actorUserId: actor.principal.userId,
      metadata: { organizationId, broadcastId, recipientCount },
      context: actor.context,
    });
    return { broadcastId, recipientCount };
  }

  /**
   * "إضافة مسؤول نقابة" — assign a syndicate admin: an ordinary SUPERVISOR
   * membership carrying the complete syndicate-scoped permission set
   * ({@link SYNDICATE_ADMIN_PERMISSION_KEYS}). Never a global role.
   */
  async assignAdmin(
    organizationId: string,
    input: { email: string },
    actor: SyndicateActor,
  ): Promise<SupervisorMembershipSummary> {
    await this.requireActiveSyndicate(organizationId);
    const summary = await this.supervisors.assign(
      organizationId,
      { email: input.email, permissions: [...SYNDICATE_ADMIN_PERMISSION_KEYS] },
      { actorUserId: actor.principal.userId, context: actor.context },
    );
    await this.audit.record({
      action: SyndicateAuditAction.ADMIN_ASSIGNED,
      entityType: SyndicateAuditEntity.SYNDICATE,
      entityId: organizationId,
      actorUserId: actor.principal.userId,
      metadata: { organizationId, userId: summary.userId },
      context: actor.context,
    });
    return summary;
  }

  private async endRegistration(
    r: SyndicateRegistration,
    status: 'CANCELLED' | 'REMOVED',
    actor: SyndicateActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ended = await this.registrations.end(r.id, status, actor.principal.userId, tx);
      if (!ended) throw new NotFoundError('Member not found');
      await this.audit.record(
        {
          action: SyndicateAuditAction.MEMBER_REGISTRATION_ENDED,
          entityType: SyndicateAuditEntity.REGISTRATION,
          entityId: r.id,
          actorUserId: actor.principal.userId,
          metadata: { organizationId: r.organizationId, userId: r.userId, status },
          context: actor.context,
        },
        tx,
      );
    });
    this.log.debug({ registrationId: r.id, status }, 'syndicate registration ended');
  }
}
