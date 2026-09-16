import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import { resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import { OWNER_ORG_ROLE_KEY } from '../../organizations/domain/organization-rbac.constants.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationRbacRepository } from '../../organizations/infrastructure/organization-rbac.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type { ConversationRepository } from '../../chat/infrastructure/conversation.repository.js';
import type { MessageRepository } from '../../chat/infrastructure/message.repository.js';
import type {
  ChatRoomDetailDTO,
  ChatRoomMemberDTO,
  ChatRoomSummaryDTO,
  CreateChatRoomInput,
  ListChatRoomsFilter,
} from '../domain/chat-room.types.js';
import type { ChatRoomRepository } from '../infrastructure/chat-room.repository.js';

const LOGO_URL_TTL_SECONDS = 3600;
const MEMBER_ROLE_KEY = 'STAFF';

export interface ChatRoomActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Global Chat — public discussion rooms. A room is an `organizations` row
 * (`type = 'CHAT_ROOM'`) + a `chat_room_details` extension row (reusing the
 * organization aggregate, its membership/supervisor RBAC and logo upload
 * flow, same as `SyndicateService`), plus exactly ONE backing `conversations`
 * row (type `CHAT_ROOM`) for its discussion — reusing `messages`/
 * `conversation_participants` and every existing message endpoint as-is
 * (`ChatService.sendMessage`/`listMessages`/`markRead`/`deleteMessage`, all
 * generic once `ChatService.resolveSide` knows the `ROOM_MEMBER` side).
 *
 * Joining/leaving a room is admin-permission-free (public, self-service),
 * mirroring the farm join-code flow — gated only on the room being ACTIVE.
 * A member holds the org role STAFF (no vet-approval gate, unlike
 * VETERINARIAN); a moderator is a SUPERVISOR membership assigned via the
 * existing `OrganizationSupervisorService` with a subset of the `chat_room.*`
 * organization permission keys.
 */
export class ChatRoomService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly rooms: ChatRoomRepository,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly orgRbac: OrganizationRbacRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly users: UserService,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'chat-room-service' });
  }

  // --- creation (ADMIN only, enforced by the route) -------------------

  async create(input: CreateChatRoomInput, actor: ChatRoomActor): Promise<ChatRoomDetailDTO> {
    const organizationId = await this.db.transaction(async (tx) => {
      const ownerRole = await this.orgRbac.findRoleByKey(OWNER_ORG_ROLE_KEY, tx);
      if (!ownerRole) throw new Error('Seed data missing: organization role "OWNER"');

      const org = await this.organizations.create(
        { type: 'CHAT_ROOM', name: input.name, description: input.description ?? null, ownerUserId: actor.actorUserId },
        tx,
      );
      // Admin-created — active immediately, no PENDING moderation queue (same as SYNDICATE).
      await this.organizations.updateStatus(org.id, { status: 'ACTIVE', decidedBy: actor.actorUserId }, tx);
      await this.organizations.insertDetails('CHAT_ROOM', org.id, { rules: input.rules ?? null }, tx);
      await this.memberships.create(
        {
          organizationId: org.id,
          userId: actor.actorUserId,
          organizationRoleId: ownerRole.id,
          status: 'ACTIVE',
          addedBy: actor.actorUserId,
        },
        tx,
      );

      const conversation = await this.conversations.create(
        {
          type: 'CHAT_ROOM',
          organizationId: org.id,
          petOwnerUserId: null,
          memberUserId: null,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.conversations.addParticipants(
        [{ conversationId: conversation.id, userId: actor.actorUserId, role: 'ROOM_MEMBER' }],
        tx,
      );

      await this.audit.record(
        {
          action: AuditAction.CHAT_ROOM_CREATED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: org.id,
          actorUserId: actor.actorUserId,
          metadata: { name: org.name },
          context: actor.context,
        },
        tx,
      );
      return org.id;
    });

    this.events.publish('chat_room.created', { organizationId, actorUserId: actor.actorUserId });
    return this.getOne(organizationId, actor.actorUserId);
  }

  // --- reads -----------------------------------------------------

  async listPublic(
    filter: ListChatRoomsFilter,
    viewerUserId: string,
  ): Promise<{ items: ChatRoomSummaryDTO[]; total: number }> {
    const { items, total } = await this.organizations.list({
      page: filter.page,
      pageSize: filter.pageSize,
      type: 'CHAT_ROOM',
      status: 'ACTIVE',
      search: filter.search,
    });
    const ids = items.map((o) => o.id);
    const [detailsMap, memberCounts, joinedIds, conversationIds] = await Promise.all([
      this.rooms.findDetailsByIds(ids),
      this.rooms.countActiveMembersByOrgIds(ids),
      this.rooms.findActiveMembershipOrgIds(viewerUserId, ids),
      this.rooms.findConversationIdsByOrgIds(ids),
    ]);
    const unreadByConversationId = await this.conversations.unreadCounts(
      viewerUserId,
      [...conversationIds.values()],
    );

    const dtos: ChatRoomSummaryDTO[] = await Promise.all(
      items.map(async (org) => {
        const details = detailsMap.get(org.id);
        const conversationId = conversationIds.get(org.id);
        return {
          id: org.id,
          name: org.name,
          description: org.description,
          logoUrl: await resolveStorageUrlOrNull(this.storage, details?.logoKey ?? null, LOGO_URL_TTL_SECONDS),
          memberCount: memberCounts.get(org.id) ?? 0,
          unreadCount: conversationId ? unreadByConversationId.get(conversationId) ?? 0 : 0,
          isJoined: joinedIds.has(org.id),
          status: org.status,
          createdAt: org.createdAt,
        };
      }),
    );
    return { items: dtos, total };
  }

  async getOne(organizationId: string, viewerUserId: string): Promise<ChatRoomDetailDTO> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'CHAT_ROOM') throw new NotFoundError('Chat room not found');

    const [details, memberCount, membership, conversation] = await Promise.all([
      this.rooms.findDetails(organizationId),
      this.rooms.countActiveMembers(organizationId),
      this.memberships.findByUserAndOrg(viewerUserId, organizationId),
      this.conversations.findChatRoomConversation(organizationId),
    ]);
    if (!conversation) throw new NotFoundError('Chat room not found');

    const isJoined = membership?.status === 'ACTIVE';
    const participant = isJoined
      ? await this.conversations.findParticipant(conversation.id, viewerUserId)
      : null;
    const unread = isJoined
      ? (await this.conversations.unreadCounts(viewerUserId, [conversation.id])).get(conversation.id) ?? 0
      : 0;
    const pinnedMessage = details?.pinnedMessageId
      ? await this.messages.findById(details.pinnedMessageId)
      : null;

    return {
      id: org.id,
      name: org.name,
      description: org.description,
      logoUrl: await resolveStorageUrlOrNull(this.storage, details?.logoKey ?? null, LOGO_URL_TTL_SECONDS),
      memberCount,
      unreadCount: unread,
      isJoined,
      status: org.status,
      createdAt: org.createdAt,
      rules: details?.rules ?? null,
      conversationId: conversation.id,
      joinedAt: isJoined ? membership!.createdAt : null,
      notificationsMuted: participant?.notificationsMuted ?? false,
      pinnedMessage:
        pinnedMessage && !pinnedMessage.deletedAt
          ? {
              id: pinnedMessage.id,
              body: pinnedMessage.body,
              senderUserId: pinnedMessage.senderUserId,
              createdAt: pinnedMessage.createdAt,
            }
          : null,
    };
  }

  /**
   * Lean member roster (id + name only) — any ACTIVE member of the room may
   * list it (self-service, same trust boundary as join/leave), so the mobile
   * thread screen can show "who said what" without the generic
   * `member.read`-gated `GET /organizations/:id/members` endpoint, which a
   * plain room member (org role STAFF) does not hold.
   */
  async listMembers(
    organizationId: string,
    viewerUserId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: ChatRoomMemberDTO[]; total: number }> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'CHAT_ROOM') throw new NotFoundError('Chat room not found');

    const viewer = await this.memberships.findByUserAndOrg(viewerUserId, organizationId);
    if (!viewer || viewer.status !== 'ACTIVE') {
      throw new NotFoundError('Chat room not found');
    }

    const { items, total } = await this.memberships.listForOrg(organizationId, {
      page,
      pageSize,
      status: 'ACTIVE',
    });
    return {
      items: items.map((m) => ({
        userId: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        roleKey: m.roleKey,
      })),
      total,
    };
  }

  // --- membership: join / leave / mute (self-service, no permission) ---

  async join(organizationId: string, actor: ChatRoomActor): Promise<ChatRoomDetailDTO> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'CHAT_ROOM') throw new NotFoundError('Chat room not found');
    if (org.status !== 'ACTIVE') {
      throw new ForbiddenError('This room is not active — joining is disabled');
    }
    const user = await this.users.getById(actor.actorUserId);
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError('Your account must be active to join a room');
    }

    const conversation = await this.conversations.findChatRoomConversation(organizationId);
    if (!conversation) throw new NotFoundError('Chat room not found');

    const existing = await this.memberships.findByUserAndOrg(actor.actorUserId, organizationId);
    if (existing?.status === 'ACTIVE') {
      return this.getOne(organizationId, actor.actorUserId);
    }

    await this.db.transaction(async (tx) => {
      const staffRole = await this.orgRbac.findRoleByKey(MEMBER_ROLE_KEY, tx);
      if (!staffRole) throw new Error(`Seed data missing: organization role "${MEMBER_ROLE_KEY}"`);

      if (existing) {
        await this.memberships.update(
          existing.id,
          { organizationRoleId: staffRole.id, status: 'ACTIVE' },
          tx,
        );
      } else {
        await this.memberships.create(
          {
            organizationId,
            userId: actor.actorUserId,
            organizationRoleId: staffRole.id,
            status: 'ACTIVE',
            addedBy: actor.actorUserId,
          },
          tx,
        );
      }

      const participant = await this.conversations.findParticipant(conversation.id, actor.actorUserId, tx);
      if (!participant) {
        await this.conversations.addParticipants(
          [{ conversationId: conversation.id, userId: actor.actorUserId, role: 'ROOM_MEMBER' }],
          tx,
        );
      } else if (participant.leftAt) {
        await this.conversations.rejoinParticipant(conversation.id, actor.actorUserId, tx);
      }

      await this.audit.record(
        {
          action: AuditAction.CHAT_ROOM_JOINED,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: organizationId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('chat_room.joined', { organizationId, userId: actor.actorUserId });
    return this.getOne(organizationId, actor.actorUserId);
  }

  async leave(organizationId: string, actor: ChatRoomActor): Promise<void> {
    const membership = await this.memberships.findByUserAndOrg(actor.actorUserId, organizationId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new NotFoundError('You are not a member of this room');
    }
    if (membership.roleKey === 'OWNER') {
      throw new ConflictError('The room owner cannot leave — transfer ownership first (not available yet)');
    }
    const conversation = await this.conversations.findChatRoomConversation(organizationId);

    await this.db.transaction(async (tx) => {
      await this.memberships.update(membership.id, { status: 'LEFT' }, tx);
      await this.orgRbac.clearSupervisorPermissions(membership.id, tx);
      if (conversation) {
        await this.conversations.leaveParticipant(conversation.id, actor.actorUserId, tx);
      }
      await this.audit.record(
        {
          action: AuditAction.CHAT_ROOM_LEFT,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: organizationId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('chat_room.left', { organizationId, userId: actor.actorUserId });
  }

  async setMuted(organizationId: string, userId: string, muted: boolean): Promise<void> {
    const conversation = await this.conversations.findChatRoomConversation(organizationId);
    if (!conversation) throw new NotFoundError('Chat room not found');
    const participant = await this.conversations.findParticipant(conversation.id, userId);
    if (!participant || participant.leftAt) {
      throw new NotFoundError('You are not a member of this room');
    }
    await this.conversations.setParticipantMuted(conversation.id, userId, muted);
  }

  // --- moderation (chat_room.rules.manage, checked by the route) -----

  async updateRules(organizationId: string, rules: string | null, actor: ChatRoomActor): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'CHAT_ROOM') throw new NotFoundError('Chat room not found');
    await this.rooms.updateRules(organizationId, rules);
    await this.audit.record({
      action: AuditAction.CHAT_ROOM_RULES_UPDATED,
      entityType: AuditEntityType.ORGANIZATION,
      entityId: organizationId,
      actorUserId: actor.actorUserId,
      metadata: { organizationId },
      context: actor.context,
    });
  }

  async pinMessage(organizationId: string, messageId: string, actor: ChatRoomActor): Promise<void> {
    const conversation = await this.conversations.findChatRoomConversation(organizationId);
    if (!conversation) throw new NotFoundError('Chat room not found');
    const message = await this.messages.findByIdInConversation(messageId, conversation.id);
    if (!message || message.deletedAt) throw new NotFoundError('Message not found in this room');
    await this.rooms.setPinnedMessage(organizationId, messageId);
    await this.audit.record({
      action: AuditAction.CHAT_ROOM_MESSAGE_PINNED,
      entityType: AuditEntityType.MESSAGE,
      entityId: messageId,
      actorUserId: actor.actorUserId,
      metadata: { organizationId },
      context: actor.context,
    });
  }

  /**
   * Moderator removal of ANOTHER member's message (`chat_room.message.delete`,
   * checked by the route) — deliberately separate from `ChatService
   * .deleteMessage`, which only ever lets a message's own sender delete it.
   */
  async deleteMessage(organizationId: string, messageId: string, actor: ChatRoomActor): Promise<void> {
    const conversation = await this.conversations.findChatRoomConversation(organizationId);
    if (!conversation) throw new NotFoundError('Chat room not found');
    const message = await this.messages.findByIdInConversation(messageId, conversation.id);
    if (!message) throw new NotFoundError('Message not found in this room');
    if (message.deletedAt) return;

    await this.db.transaction(async (tx) => {
      await this.messages.softDelete(messageId, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.MESSAGE_DELETED,
          entityType: AuditEntityType.MESSAGE,
          entityId: messageId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, moderatorAction: true },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('chat.message.deleted', { conversationId: conversation.id, messageId });
  }

  async unpinMessage(organizationId: string, actor: ChatRoomActor): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'CHAT_ROOM') throw new NotFoundError('Chat room not found');
    await this.rooms.setPinnedMessage(organizationId, null);
    await this.audit.record({
      action: AuditAction.CHAT_ROOM_MESSAGE_UNPINNED,
      entityType: AuditEntityType.ORGANIZATION,
      entityId: organizationId,
      actorUserId: actor.actorUserId,
      metadata: { organizationId },
      context: actor.context,
    });
  }
}
