import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type { UserService } from '../../users/user.service.js';
import type { ConversationSide, ConversationSubjectType } from '../domain/chat.constants.js';
import { ChatPolicy } from '../domain/chat.policy.js';
import {
  toMessageDTO,
  type Conversation,
  type ConversationDTO,
  type ListConversationsFilter,
  type MessageDTO,
} from '../domain/chat.types.js';
import type { ConversationRepository } from '../infrastructure/conversation.repository.js';
import type { MessageRepository } from '../infrastructure/message.repository.js';

export interface ChatActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface ChatOrgRef {
  id: string;
  type: string;
  status: string;
  ownerUserId: string;
}

/** Ceiling on candidate conversations scanned for a list request (cf. Phase 8). */
const CANDIDATE_CEILING = 500;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * Chat use cases. Authorization is RELATIONSHIP-scoped and always evaluated
 * against CURRENT state (org ownership + membership), never trusting a stored
 * participant row for access (docs §35 / §36):
 *
 *   PET_OWNER_CLINIC  → the pet owner, OR any ACTIVE member of the clinic org.
 *   FARM_OWNER_MEMBER → the current farm owner, OR the named member while their
 *                       membership is still ACTIVE.
 *
 * The same {@link resolveSide} check backs the HTTP middleware and the realtime
 * subscription authorizer, so a socket cannot join a conversation room the
 * caller could not GET.
 */
export class ChatService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly memberships: MembershipRepository,
    private readonly organizations: OrganizationRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'chat-service' });
  }

  // --- authorization core ------------------------------------------------

  /** Current-state access side, or `null` when the caller has no relationship. */
  private async resolveSide(
    userId: string,
    conversation: Conversation,
  ): Promise<ConversationSide | null> {
    if (conversation.type === 'PET_OWNER_VETERINARIAN') {
      // A direct 1:1 marketplace deal — both sides have an explicit participant
      // row; no org / membership involved.
      if (userId === conversation.petOwnerUserId) return 'PET_OWNER';
      if (userId === conversation.veterinarianUserId) return 'VETERINARIAN';
      return null;
    }
    if (conversation.type === 'PET_OWNER_CLINIC') {
      if (userId === conversation.petOwnerUserId) return 'PET_OWNER';
      if (!conversation.organizationId) return null;
      const m = await this.memberships.findByUserAndOrg(userId, conversation.organizationId);
      return m?.status === 'ACTIVE' ? 'CLINIC' : null;
    }
    // FARM_OWNER_MEMBER
    if (!conversation.organizationId) return null;
    const org = await this.organizations.findById(conversation.organizationId);
    if (org && userId === org.ownerUserId) return 'FARM_OWNER';
    if (userId === conversation.memberUserId) {
      const m = await this.memberships.findByUserAndOrg(userId, conversation.organizationId);
      if (m?.status === 'ACTIVE' && m.roleKey !== 'OWNER') return 'FARM_MEMBER';
    }
    return null;
  }

  /** Throwing variant for HTTP middleware. `404` (not `403`) so ids do not leak. */
  async assertAccess(userId: string, conversation: Conversation): Promise<ConversationSide> {
    const side = await this.resolveSide(userId, conversation);
    if (!side) throw new NotFoundError('Conversation not found');
    return side;
  }

  /** Non-throwing variant for the realtime subscription authorizer. */
  async canAccessConversationId(userId: string, conversationId: string): Promise<boolean> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) return false;
    return (await this.resolveSide(userId, conversation)) !== null;
  }

  // --- conversation creation ------------------------------------------

  async getOrCreateConversation(
    actor: ChatActor,
    org: ChatOrgRef,
    targetUserId: string | null,
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    ChatPolicy.assertChatOrganizationType(org.type);
    if (org.status !== 'ACTIVE') {
      throw new ForbiddenError('The organization is not active — messaging is disabled', {
        code: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      });
    }

    if (ChatPolicy.isClinicType(org.type)) {
      const petOwnerUserId = await this.resolveClinicCounterpart(actor, org, targetUserId);
      return this.getOrCreatePetOwnerClinic(actor, org.id, petOwnerUserId);
    }

    const memberUserId = await this.resolveFarmCounterpart(actor, org, targetUserId);
    return this.getOrCreateFarmMember(actor, org, memberUserId);
  }

  private async resolveClinicCounterpart(
    actor: ChatActor,
    org: ChatOrgRef,
    targetUserId: string | null,
  ): Promise<string> {
    const callerMembership = await this.memberships.findByUserAndOrg(actor.actorUserId, org.id);
    const callerIsActiveClinicMember = callerMembership?.status === 'ACTIVE';

    if (callerIsActiveClinicMember) {
      if (!targetUserId) {
        throw new BadRequestError('targetUserId is required when the clinic starts a conversation');
      }
      const target = await this.users.getByIdOrNull(targetUserId);
      if (!target) throw new BadRequestError('Target user not found');
      const targetMembership = await this.memberships.findByUserAndOrg(targetUserId, org.id);
      if (targetMembership?.status === 'ACTIVE') {
        throw new BadRequestError(
          'A clinic conversation is Pet Owner ↔ Clinic — the target cannot be a clinic member',
        );
      }
      return targetUserId;
    }

    if (targetUserId && targetUserId !== actor.actorUserId) {
      throw new ForbiddenError(
        'Only a clinic member can open a conversation on behalf of another user',
      );
    }
    return actor.actorUserId;
  }

  private async resolveFarmCounterpart(
    actor: ChatActor,
    org: ChatOrgRef,
    targetUserId: string | null,
  ): Promise<string> {
    if (actor.actorUserId === org.ownerUserId) {
      if (!targetUserId) {
        throw new BadRequestError(
          'targetUserId is required when the farm owner starts a conversation',
        );
      }
      const targetMembership = await this.memberships.findByUserAndOrg(targetUserId, org.id);
      if (
        !targetMembership ||
        targetMembership.status !== 'ACTIVE' ||
        targetMembership.roleKey === 'OWNER'
      ) {
        throw new BadRequestError('The target must be an active non-owner member of this farm');
      }
      return targetUserId;
    }

    const callerMembership = await this.memberships.findByUserAndOrg(actor.actorUserId, org.id);
    if (
      !callerMembership ||
      callerMembership.status !== 'ACTIVE' ||
      callerMembership.roleKey === 'OWNER'
    ) {
      throw new ForbiddenError(
        'Only the farm owner or an active farm member can open a farm conversation',
      );
    }
    if (targetUserId && targetUserId !== actor.actorUserId) {
      throw new ForbiddenError('A farm member can only open their own conversation with the owner');
    }
    return actor.actorUserId;
  }

  private async getOrCreatePetOwnerClinic(
    actor: ChatActor,
    organizationId: string,
    petOwnerUserId: string,
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    const existing = await this.conversations.findPetOwnerClinic(organizationId, petOwnerUserId);
    if (existing) {
      const side = await this.assertAccess(actor.actorUserId, existing);
      return {
        conversation: await this.decorate(actor.actorUserId, existing, side),
        created: false,
      };
    }

    let conversation: Conversation;
    try {
      conversation = await this.db.transaction(async (tx) => {
        const created = await this.conversations.create(
          {
            type: 'PET_OWNER_CLINIC',
            organizationId,
            petOwnerUserId,
            memberUserId: null,
            createdByUserId: actor.actorUserId,
          },
          tx,
        );
        await this.conversations.addParticipants(
          [{ conversationId: created.id, userId: petOwnerUserId, role: 'PET_OWNER' }],
          tx,
        );
        await this.audit.record(
          {
            action: AuditAction.CONVERSATION_CREATED,
            entityType: AuditEntityType.CONVERSATION,
            entityId: created.id,
            actorUserId: actor.actorUserId,
            metadata: { conversationId: created.id, organizationId, type: 'PET_OWNER_CLINIC' },
            context: actor.context,
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.conversations.findPetOwnerClinic(organizationId, petOwnerUserId);
        if (raced) {
          const side = await this.assertAccess(actor.actorUserId, raced);
          return {
            conversation: await this.decorate(actor.actorUserId, raced, side),
            created: false,
          };
        }
      }
      throw err;
    }

    this.events.publish('chat.conversation.created', {
      conversationId: conversation.id,
      organizationId,
      type: conversation.type,
      participantUserIds: [petOwnerUserId],
    });
    const side = await this.assertAccess(actor.actorUserId, conversation);
    return {
      conversation: await this.decorate(actor.actorUserId, conversation, side),
      created: true,
    };
  }

  private async getOrCreateFarmMember(
    actor: ChatActor,
    org: ChatOrgRef,
    memberUserId: string,
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    const existing = await this.conversations.findFarmMember(org.id, memberUserId);
    if (existing) {
      const side = await this.assertAccess(actor.actorUserId, existing);
      return {
        conversation: await this.decorate(actor.actorUserId, existing, side),
        created: false,
      };
    }

    let conversation: Conversation;
    try {
      conversation = await this.db.transaction(async (tx) => {
        const created = await this.conversations.create(
          {
            type: 'FARM_OWNER_MEMBER',
            organizationId: org.id,
            petOwnerUserId: null,
            memberUserId,
            createdByUserId: actor.actorUserId,
          },
          tx,
        );
        await this.conversations.addParticipants(
          [
            { conversationId: created.id, userId: org.ownerUserId, role: 'FARM_OWNER' },
            { conversationId: created.id, userId: memberUserId, role: 'FARM_MEMBER' },
          ],
          tx,
        );
        await this.audit.record(
          {
            action: AuditAction.CONVERSATION_CREATED,
            entityType: AuditEntityType.CONVERSATION,
            entityId: created.id,
            actorUserId: actor.actorUserId,
            metadata: {
              conversationId: created.id,
              organizationId: org.id,
              type: 'FARM_OWNER_MEMBER',
            },
            context: actor.context,
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.conversations.findFarmMember(org.id, memberUserId);
        if (raced) {
          const side = await this.assertAccess(actor.actorUserId, raced);
          return {
            conversation: await this.decorate(actor.actorUserId, raced, side),
            created: false,
          };
        }
      }
      throw err;
    }

    this.events.publish('chat.conversation.created', {
      conversationId: conversation.id,
      organizationId: org.id,
      type: conversation.type,
      participantUserIds: [org.ownerUserId, memberUserId],
    });
    const side = await this.assertAccess(actor.actorUserId, conversation);
    return {
      conversation: await this.decorate(actor.actorUserId, conversation, side),
      created: true,
    };
  }

  // --- marketplace deal conversations (PET_OWNER_VETERINARIAN) --------
  //
  // Created / driven by the `vet-services` and `vet-jobs` modules. A direct
  // 1:1 chat between any user and a Veterinarian, optionally pinned to an
  // engagement (a service offer, a listing-request, or a job application).
  // "Chat immediately" (before any engagement is accepted) and "on accept"
  // both funnel through `getOrCreateDeal`.

  async getOrCreateDeal(
    actor: ChatActor,
    params: {
      petOwnerUserId: string;
      veterinarianUserId: string;
      subjectType?: ConversationSubjectType | null;
      subjectId?: string | null;
    },
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    const { petOwnerUserId, veterinarianUserId } = params;
    if (petOwnerUserId === veterinarianUserId) {
      throw new BadRequestError('A deal conversation needs two distinct users');
    }
    if (actor.actorUserId !== petOwnerUserId && actor.actorUserId !== veterinarianUserId) {
      throw new ForbiddenError('Only the two deal participants can open this conversation');
    }

    const existing = await this.conversations.findPetOwnerVeterinarian(
      petOwnerUserId,
      veterinarianUserId,
    );
    if (existing) {
      if (params.subjectType && params.subjectId && !existing.subjectType) {
        await this.db.transaction((tx) =>
          this.conversations.setSubject(
            existing.id,
            params.subjectType as string,
            params.subjectId as string,
            tx,
          ),
        );
      }
      const fresh = (await this.conversations.findById(existing.id)) ?? existing;
      const side = await this.assertAccess(actor.actorUserId, fresh);
      return { conversation: await this.decorate(actor.actorUserId, fresh, side), created: false };
    }

    let conversation: Conversation;
    try {
      conversation = await this.db.transaction(async (tx) => {
        const created = await this.conversations.create(
          {
            type: 'PET_OWNER_VETERINARIAN',
            organizationId: null,
            petOwnerUserId,
            memberUserId: null,
            veterinarianUserId,
            subjectType: params.subjectType ?? null,
            subjectId: params.subjectId ?? null,
            createdByUserId: actor.actorUserId,
          },
          tx,
        );
        await this.conversations.addParticipants(
          [
            { conversationId: created.id, userId: petOwnerUserId, role: 'PET_OWNER' },
            { conversationId: created.id, userId: veterinarianUserId, role: 'VETERINARIAN' },
          ],
          tx,
        );
        await this.audit.record(
          {
            action: AuditAction.CONVERSATION_CREATED,
            entityType: AuditEntityType.CONVERSATION,
            entityId: created.id,
            actorUserId: actor.actorUserId,
            metadata: { conversationId: created.id, type: 'PET_OWNER_VETERINARIAN' },
            context: actor.context,
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.conversations.findPetOwnerVeterinarian(
          petOwnerUserId,
          veterinarianUserId,
        );
        if (raced) {
          const side = await this.assertAccess(actor.actorUserId, raced);
          return {
            conversation: await this.decorate(actor.actorUserId, raced, side),
            created: false,
          };
        }
      }
      throw err;
    }

    this.events.publish('chat.conversation.created', {
      conversationId: conversation.id,
      organizationId: null,
      type: conversation.type,
      participantUserIds: [petOwnerUserId, veterinarianUserId],
    });
    const side = await this.assertAccess(actor.actorUserId, conversation);
    return {
      conversation: await this.decorate(actor.actorUserId, conversation, side),
      created: true,
    };
  }

  /** Pin an accepted engagement onto the pair's conversation (idempotent). */
  async pinDealSubject(
    conversationId: string,
    subjectType: ConversationSubjectType,
    subjectId: string,
  ): Promise<void> {
    await this.db.transaction((tx) =>
      this.conversations.setSubject(conversationId, subjectType, subjectId, tx),
    );
  }

  /**
   * Set the job status of a deal conversation. `COMPLETED` ("إنهاء الطلب") is
   * driven by the `vet-services` engagement; `CLOSED` ("إيقاف المحادثة") is a
   * plain chat action available to either participant.
   */
  async setDealStatus(
    actor: ChatActor,
    conversationId: string,
    status: 'COMPLETED' | 'CLOSED',
  ): Promise<ConversationDTO> {
    const conversation = await this.load(conversationId);
    if (conversation.type !== 'PET_OWNER_VETERINARIAN') {
      throw new BadRequestError('Only a marketplace deal conversation has a job status');
    }
    const side = await this.assertAccess(actor.actorUserId, conversation);
    const updated = await this.db.transaction(async (tx) => {
      const c = await this.conversations.setStatus(conversationId, status, tx);
      await this.audit.record(
        {
          action: AuditAction.CONVERSATION_STATUS_CHANGED,
          entityType: AuditEntityType.CONVERSATION,
          entityId: conversationId,
          actorUserId: actor.actorUserId,
          metadata: { conversationId, statusChangedTo: status },
          context: actor.context,
        },
        tx,
      );
      return c;
    });
    return this.decorate(actor.actorUserId, updated, side);
  }

  async getDealBySubject(
    userId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<ConversationDTO | null> {
    const conversation = await this.conversations.findBySubject(subjectType, subjectId);
    if (!conversation) return null;
    const side = await this.resolveSide(userId, conversation);
    if (!side) return null;
    return this.decorate(userId, conversation, side);
  }

  // --- reads -----------------------------------------------------------

  async listConversations(
    userId: string,
    filter: ListConversationsFilter,
  ): Promise<{ items: ConversationDTO[]; total: number }> {
    const candidates = await this.conversations.listCandidatesForUser(userId, {
      organizationId: filter.organizationId,
      limit: CANDIDATE_CEILING,
    });

    const accessible: Array<{ conversation: Conversation; side: ConversationSide }> = [];
    for (const conversation of candidates) {
      const side = await this.resolveSide(userId, conversation);
      if (side) accessible.push({ conversation, side });
    }

    const total = accessible.length;
    const start = (filter.page - 1) * filter.pageSize;
    const pageSlice = accessible.slice(start, start + filter.pageSize);

    const unread = await this.conversations.unreadCounts(
      userId,
      pageSlice.map((x) => x.conversation.id),
    );

    const items = pageSlice.map((x) =>
      this.toDTO(x.conversation, x.side, this.unreadFor(x.side, unread.get(x.conversation.id))),
    );
    return { items, total };
  }

  /** Load a conversation by id or 404 (ids do not leak — same message as no-access). */
  private async load(conversationId: string): Promise<Conversation> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) throw new NotFoundError('Conversation not found');
    return conversation;
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationDTO> {
    const conversation = await this.load(conversationId);
    const side = await this.assertAccess(userId, conversation);
    return this.decorate(userId, conversation, side);
  }

  async listMessages(
    userId: string,
    conversationId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: MessageDTO[]; total: number }> {
    const conversation = await this.load(conversationId);
    await this.assertAccess(userId, conversation);
    const { items, total } = await this.messages.listForConversation(conversation.id, {
      page,
      pageSize,
    });
    return { items: items.map(toMessageDTO), total };
  }

  // --- writes --------------------------------------------------------

  async sendMessage(actor: ChatActor, conversationId: string, body: string): Promise<MessageDTO> {
    const conversation = await this.load(conversationId);
    const side = await this.assertAccess(actor.actorUserId, conversation);

    if (conversation.type === 'PET_OWNER_VETERINARIAN') {
      if (conversation.status === 'CLOSED') {
        throw new ForbiddenError('This conversation has been closed — messaging is disabled', {
          code: ErrorCode.CONVERSATION_CLOSED,
        });
      }
    } else {
      const org = conversation.organizationId
        ? await this.organizations.findById(conversation.organizationId)
        : null;
      if (!org || org.status !== 'ACTIVE') {
        throw new ForbiddenError('The organization is not active — messaging is disabled', {
          code: ErrorCode.ORGANIZATION_NOT_ACTIVE,
        });
      }
    }

    const now = new Date();
    const message = await this.db.transaction(async (tx) => {
      const created = await this.messages.create(
        {
          conversationId: conversation.id,
          senderUserId: actor.actorUserId,
          body,
          type: 'TEXT',
        },
        tx,
      );
      await this.conversations.touchLastMessageAt(conversation.id, now, tx);
      // The sender has, by definition, read their own message.
      if (side !== 'CLINIC') {
        await this.conversations.setParticipantLastRead(
          conversation.id,
          actor.actorUserId,
          created.id,
          tx,
        );
      }
      return created;
    });

    this.events.publish('chat.message.created', {
      conversationId: conversation.id,
      messageId: message.id,
      senderUserId: actor.actorUserId,
    });
    return toMessageDTO(message);
  }

  async markRead(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationDTO> {
    const conversation = await this.load(conversationId);
    const side = await this.assertAccess(userId, conversation);

    const message = await this.messages.findByIdInConversation(messageId, conversation.id);
    if (!message) throw new BadRequestError('That message does not belong to this conversation');

    if (side !== 'CLINIC') {
      await this.db.transaction((tx) =>
        this.conversations.setParticipantLastRead(conversation.id, userId, messageId, tx),
      );
    }
    return this.decorate(userId, conversation, side);
  }

  async deleteMessage(actor: ChatActor, messageId: string): Promise<MessageDTO> {
    const message = await this.messages.findById(messageId);
    if (!message) throw new NotFoundError('Message not found');

    const conversation = await this.conversations.findById(message.conversationId);
    if (!conversation) throw new NotFoundError('Message not found');

    const side = await this.resolveSide(actor.actorUserId, conversation);
    if (!side) throw new NotFoundError('Message not found');

    if (message.senderUserId !== actor.actorUserId) {
      throw new ForbiddenError('You can only delete your own messages');
    }
    if (message.deletedAt) return toMessageDTO(message);

    const updated = await this.db.transaction(async (tx) => {
      const deleted = await this.messages.softDelete(messageId, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.MESSAGE_DELETED,
          entityType: AuditEntityType.MESSAGE,
          entityId: messageId,
          actorUserId: actor.actorUserId,
          metadata: { conversationId: conversation.id, messageId },
          context: actor.context,
        },
        tx,
      );
      return deleted;
    });

    this.events.publish('chat.message.deleted', {
      conversationId: conversation.id,
      messageId,
    });
    return toMessageDTO(updated);
  }

  // --- DTO assembly -------------------------------------------------

  private unreadFor(side: ConversationSide, count: number | undefined): number | null {
    if (side === 'CLINIC') return null; // dynamic clinic side has no per-member read state
    return count ?? 0;
  }

  private toDTO(
    conversation: Conversation,
    side: ConversationSide,
    unreadCount: number | null,
  ): ConversationDTO {
    let counterpartUserId: string | null;
    if (conversation.type === 'PET_OWNER_CLINIC') {
      counterpartUserId = conversation.petOwnerUserId;
    } else if (conversation.type === 'PET_OWNER_VETERINARIAN') {
      counterpartUserId =
        side === 'PET_OWNER'
          ? conversation.veterinarianUserId
          : conversation.petOwnerUserId;
    } else {
      counterpartUserId = conversation.memberUserId;
    }
    return {
      id: conversation.id,
      type: conversation.type,
      organizationId: conversation.organizationId,
      counterpartUserId,
      viewerSide: side,
      subjectType: conversation.subjectType,
      subjectId: conversation.subjectId,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      unreadCount,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private async decorate(
    userId: string,
    conversation: Conversation,
    side: ConversationSide,
  ): Promise<ConversationDTO> {
    if (side === 'CLINIC') return this.toDTO(conversation, side, null);
    const unread = await this.conversations.unreadCounts(userId, [conversation.id]);
    return this.toDTO(conversation, side, unread.get(conversation.id) ?? 0);
  }
}
