import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { NotificationReadPort } from '../../../shared/events/notification-read.port.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OrganizationOperabilityService } from '../../organizations/application/organization-operability.service.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type { UserService } from '../../users/user.service.js';
import type {
  ChatAttachmentKind,
  ConversationSide,
  ConversationSubjectType,
} from '../domain/chat.constants.js';
import { ChatPolicy } from '../domain/chat.policy.js';
import {
  toMessageDTO,
  type Conversation,
  type ConversationDTO,
  type ListConversationsFilter,
  type Message,
  type MessageAttachmentDTO,
  type MessageDTO,
} from '../domain/chat.types.js';
import type { ConversationRepository } from '../infrastructure/conversation.repository.js';
import type { MessageRepository } from '../infrastructure/message.repository.js';
import type { ChatAttachmentMedia, ChatAttachmentPresign } from './chat-attachment-media.js';

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
/** Sides resolved live through organization membership — no participant row / read pointer. */
const ORG_SIDES: ReadonlySet<ConversationSide> = new Set<ConversationSide>([
  'CLINIC',
  'VETERINARY_OFFICE',
  'SYNDICATE',
]);

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
    /** Chat media (image / video / file). Optional only for narrow harnesses; the container injects it. */
    private readonly media: ChatAttachmentMedia | null = null,
    /** Clears the conversation's "new message" alerts when the user reads it. */
    private readonly notificationReads: NotificationReadPort | null = null,
    /**
     * The shared "may this organization operate?" rule. A pending / inactive /
     * subscription-expired CLINIC loses its clinic-side chat access (HTTP and
     * realtime rooms) and nobody can post into its conversations.
     */
    private readonly operability: OrganizationOperabilityService | null = null,
  ) {
    this.log = logger.child({ component: 'chat-service' });
  }

  /** Message → DTO; the attachment's signed URL is minted only here, after an access check. */
  private async messageDto(m: Message): Promise<MessageDTO> {
    const attachment =
      m.attachment && !m.deletedAt && this.media ? await this.media.toDTO(m.attachment) : null;
    return toMessageDTO(m, attachment);
  }

  /** Conversation-level "may new messages be posted here" rule (shared by send + attachment upload). */
  private async assertWritable(conversation: Conversation): Promise<void> {
    // A clinic may pause its chat with a pet owner (legacy "إيقاف المحادثة").
    if (conversation.type === 'PET_OWNER_CLINIC' && conversation.status === 'CLOSED') {
      throw new ForbiddenError('This conversation has been paused by the clinic', {
        code: ErrorCode.CONVERSATION_CLOSED,
      });
    }
    if (
      conversation.type === 'PET_OWNER_VETERINARIAN' ||
      conversation.type === 'ANIMAL_PUBLICATION'
    ) {
      if (conversation.status === 'CLOSED') {
        throw new ForbiddenError('This conversation has been closed — messaging is disabled', {
          code: ErrorCode.CONVERSATION_CLOSED,
        });
      }
      return;
    }
    const org = conversation.organizationId
      ? await this.organizations.findById(conversation.organizationId)
      : null;
    if (!org || org.status !== 'ACTIVE') {
      throw new ForbiddenError('The organization is not active — messaging is disabled', {
        code: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      });
    }
    if (conversation.type === 'PET_OWNER_CLINIC' && this.operability) {
      // Expired clinic → read-only for both sides (owner keeps the history).
      await this.operability.assertOperational(null, org);
    }
  }

  /** Clinic side only exists while the clinic may operate (shared rule). */
  private async clinicOperational(organizationId: string): Promise<boolean> {
    if (!this.operability) return true;
    const org = await this.organizations.findById(organizationId);
    if (!org) return false;
    return (await this.operability.assess(org)).operational;
  }

  private requireMedia(): ChatAttachmentMedia {
    if (!this.media) throw new BadRequestError('chat attachments are not available');
    return this.media;
  }

  /** Step 1 of sending media: a presigned PUT, scoped to this conversation. */
  async requestAttachmentUpload(
    userId: string,
    conversationId: string,
    input: { kind: ChatAttachmentKind; filename: string; mimeType: string; size: number },
  ): Promise<ChatAttachmentPresign> {
    const conversation = await this.load(conversationId);
    await this.assertAccess(userId, conversation);
    await this.assertWritable(conversation);
    return this.requireMedia().presignUpload(conversation.id, input);
  }

  /** Fresh signed URL for one message's attachment (e.g. after the list URL expired). */
  async getAttachmentUrl(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<MessageAttachmentDTO> {
    const conversation = await this.load(conversationId);
    await this.assertAccess(userId, conversation);
    const message = await this.messages.findByIdInConversation(messageId, conversation.id);
    if (!message || message.deletedAt || !message.attachment) {
      throw new NotFoundError('Attachment not found');
    }
    return this.requireMedia().toDTO(message.attachment);
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
    if (conversation.type === 'ANIMAL_PUBLICATION') {
      // Listing contact — exactly the two users; nobody else, ever.
      if (userId === conversation.petOwnerUserId) return 'PET_OWNER';
      if (userId === conversation.memberUserId) return 'LISTING_OWNER';
      return null;
    }
    if (
      conversation.type === 'PET_OWNER_CLINIC' ||
      conversation.type === 'PET_OWNER_VETERINARY_OFFICE'
    ) {
      if (userId === conversation.petOwnerUserId) return 'PET_OWNER';
      if (!conversation.organizationId) return null;
      const m = await this.memberships.findByUserAndOrg(userId, conversation.organizationId);
      if (m?.status !== 'ACTIVE') return null;
      if (conversation.type === 'PET_OWNER_CLINIC') {
        // Owner AND staff lose the clinic side (incl. realtime room joins) while the
        // clinic is pending / inactive / subscription-expired.
        return (await this.clinicOperational(conversation.organizationId)) ? 'CLINIC' : null;
      }
      return 'VETERINARY_OFFICE';
    }
    if (conversation.type === 'SYNDICATE_MEMBER') {
      if (userId === conversation.petOwnerUserId) return 'SYNDICATE_MEMBER';
      if (!conversation.organizationId) return null;
      const m = await this.memberships.findByUserAndOrg(userId, conversation.organizationId);
      return m?.status === 'ACTIVE' ? 'SYNDICATE' : null;
    }
    if (conversation.type === 'FARM_MEMBER_DIRECT') {
      // Farm colleagues — one of the two, and STILL an active non-owner member.
      if (userId !== conversation.petOwnerUserId && userId !== conversation.memberUserId) {
        return null;
      }
      if (!conversation.organizationId) return null;
      const m = await this.memberships.findByUserAndOrg(userId, conversation.organizationId);
      return m?.status === 'ACTIVE' && m.roleKey !== 'OWNER' ? 'FARM_MEMBER' : null;
    }
    if (conversation.type === 'CHAT_ROOM') {
      // Every room member has an explicit participant row (`ChatRoomService.join`)
      // — no live membership lookup needed, unlike CLINIC/OFFICE above.
      const p = await this.conversations.findParticipant(conversation.id, userId);
      return p && !p.leftAt ? 'ROOM_MEMBER' : null;
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
      if (this.operability) await this.operability.assertOperational(null, org);
      const petOwnerUserId = await this.resolveClinicCounterpart(actor, org, targetUserId);
      return this.getOrCreatePetOwnerClinic(actor, org.id, petOwnerUserId);
    }

    if (ChatPolicy.isVeterinaryOfficeType(org.type)) {
      // Same counterpart-resolution rules as a clinic — either party can start
      // it, the other side is always the pet owner.
      const petOwnerUserId = await this.resolveClinicCounterpart(actor, org, targetUserId);
      return this.getOrCreatePetOwnerVeterinaryOffice(actor, org.id, petOwnerUserId);
    }

    // A farm member naming another (non-owner) member → the colleagues chat.
    if (
      targetUserId &&
      targetUserId !== actor.actorUserId &&
      actor.actorUserId !== org.ownerUserId &&
      targetUserId !== org.ownerUserId
    ) {
      return this.getOrCreateFarmMemberDirect(actor, org, targetUserId);
    }

    const memberUserId = await this.resolveFarmCounterpart(actor, org, targetUserId);
    return this.getOrCreateFarmMember(actor, org, memberUserId);
  }

  /** Shared by CLINIC and VETERINARY_OFFICE — both are Pet Owner ↔ "the whole org" chats. */
  private async resolveClinicCounterpart(
    actor: ChatActor,
    org: ChatOrgRef,
    targetUserId: string | null,
  ): Promise<string> {
    const callerMembership = await this.memberships.findByUserAndOrg(actor.actorUserId, org.id);
    const callerIsActiveOrgMember = callerMembership?.status === 'ACTIVE';

    if (callerIsActiveOrgMember) {
      if (!targetUserId) {
        throw new BadRequestError(
          'targetUserId is required when the organization starts a conversation',
        );
      }
      const target = await this.users.getByIdOrNull(targetUserId);
      if (!target) throw new BadRequestError('Target user not found');
      const targetMembership = await this.memberships.findByUserAndOrg(targetUserId, org.id);
      if (targetMembership?.status === 'ACTIVE') {
        throw new BadRequestError(
          'This conversation is Pet Owner ↔ organization — the target cannot be a member',
        );
      }
      return targetUserId;
    }

    if (targetUserId && targetUserId !== actor.actorUserId) {
      throw new ForbiddenError(
        'Only an organization member can open a conversation on behalf of another user',
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

  private async getOrCreatePetOwnerVeterinaryOffice(
    actor: ChatActor,
    organizationId: string,
    petOwnerUserId: string,
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    const existing = await this.conversations.findPetOwnerVeterinaryOffice(
      organizationId,
      petOwnerUserId,
    );
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
            type: 'PET_OWNER_VETERINARY_OFFICE',
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
            metadata: {
              conversationId: created.id,
              organizationId,
              type: 'PET_OWNER_VETERINARY_OFFICE',
            },
            context: actor.context,
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.conversations.findPetOwnerVeterinaryOffice(
          organizationId,
          petOwnerUserId,
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

  /**
   * Syndicate admin ↔ registered member ("مراسلة العضو"). The caller has
   * already been authorized (`syndicate.member.message` on this syndicate) and
   * the member's ACTIVE registration verified by `SyndicateMemberService` —
   * this only finds-or-creates the conversation (idempotent, race-safe).
   */
  async getOrCreateSyndicateMember(
    actor: ChatActor,
    organizationId: string,
    memberUserId: string,
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    const existing = await this.conversations.findSyndicateMember(organizationId, memberUserId);
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
            type: 'SYNDICATE_MEMBER',
            organizationId,
            petOwnerUserId: memberUserId,
            memberUserId: null,
            createdByUserId: actor.actorUserId,
          },
          tx,
        );
        await this.conversations.addParticipants(
          [{ conversationId: created.id, userId: memberUserId, role: 'SYNDICATE_MEMBER' }],
          tx,
        );
        await this.audit.record(
          {
            action: AuditAction.CONVERSATION_CREATED,
            entityType: AuditEntityType.CONVERSATION,
            entityId: created.id,
            actorUserId: actor.actorUserId,
            metadata: { conversationId: created.id, organizationId, type: 'SYNDICATE_MEMBER' },
            context: actor.context,
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.conversations.findSyndicateMember(organizationId, memberUserId);
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
      participantUserIds: [memberUserId],
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

  /**
   * Farm colleagues (final corrections §9): two ACTIVE non-owner members of the
   * same farm — its veterinarian(s) and employees — message each other.
   * Idempotent per unordered pair.
   */
  private async getOrCreateFarmMemberDirect(
    actor: ChatActor,
    org: ChatOrgRef,
    targetUserId: string,
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    const [mine, theirs] = await Promise.all([
      this.memberships.findByUserAndOrg(actor.actorUserId, org.id),
      this.memberships.findByUserAndOrg(targetUserId, org.id),
    ]);
    if (!mine || mine.status !== 'ACTIVE' || mine.roleKey === 'OWNER') {
      throw new ForbiddenError('Only an active member of this farm can message its members');
    }
    if (!theirs || theirs.status !== 'ACTIVE' || theirs.roleKey === 'OWNER') {
      throw new BadRequestError('The target must be an active non-owner member of this farm');
    }

    const find = (): Promise<Conversation | null> =>
      this.conversations.findFarmMemberDirect(org.id, actor.actorUserId, targetUserId);
    const existing = await find();
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
            type: 'FARM_MEMBER_DIRECT',
            organizationId: org.id,
            petOwnerUserId: actor.actorUserId,
            memberUserId: targetUserId,
            createdByUserId: actor.actorUserId,
          },
          tx,
        );
        await this.conversations.addParticipants(
          [
            { conversationId: created.id, userId: actor.actorUserId, role: 'FARM_MEMBER' },
            { conversationId: created.id, userId: targetUserId, role: 'FARM_MEMBER' },
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
              type: 'FARM_MEMBER_DIRECT',
            },
            context: actor.context,
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await find();
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
      participantUserIds: [actor.actorUserId, targetUserId],
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

  /**
   * Adoption / Mating / Lost listing contact: the interested user ↔ the listing
   * owner, one conversation per (publication, interested user), pinned to the
   * publication. Called by the animals module after it has verified the
   * listing (approved, available, not the owner's own). Idempotent.
   */
  async getOrCreatePublicationContact(
    actor: ChatActor,
    params: { publicationId: string; interestedUserId: string; ownerUserId: string },
  ): Promise<{ conversation: ConversationDTO; created: boolean }> {
    const { publicationId, interestedUserId, ownerUserId } = params;
    if (interestedUserId === ownerUserId) {
      throw new BadRequestError('A listing contact needs two distinct users');
    }
    if (actor.actorUserId !== interestedUserId && actor.actorUserId !== ownerUserId) {
      throw new ForbiddenError('Only the two parties can open this conversation');
    }

    const existing = await this.conversations.findPublicationContact(
      publicationId,
      interestedUserId,
    );
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
            type: 'ANIMAL_PUBLICATION',
            organizationId: null,
            petOwnerUserId: interestedUserId,
            memberUserId: ownerUserId,
            veterinarianUserId: null,
            subjectType: 'ANIMAL_PUBLICATION',
            subjectId: publicationId,
            createdByUserId: actor.actorUserId,
          },
          tx,
        );
        await this.conversations.addParticipants(
          [
            { conversationId: created.id, userId: interestedUserId, role: 'PET_OWNER' },
            { conversationId: created.id, userId: ownerUserId, role: 'LISTING_OWNER' },
          ],
          tx,
        );
        await this.audit.record(
          {
            action: AuditAction.CONVERSATION_CREATED,
            entityType: AuditEntityType.CONVERSATION,
            entityId: created.id,
            actorUserId: actor.actorUserId,
            metadata: { conversationId: created.id, type: 'ANIMAL_PUBLICATION', publicationId },
            context: actor.context,
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.conversations.findPublicationContact(
          publicationId,
          interestedUserId,
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
      participantUserIds: [interestedUserId, ownerUserId],
    });
    const side = await this.assertAccess(actor.actorUserId, conversation);
    return {
      conversation: await this.decorate(actor.actorUserId, conversation, side),
      created: true,
    };
  }

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

  /**
   * Pause / resume a pet owner ↔ clinic conversation (legacy clinic
   * `chat.toggleActive`). Only the CLINIC side may do it; a paused
   * conversation rejects new messages from both sides until resumed.
   */
  async setClinicChatActive(
    actor: ChatActor,
    conversationId: string,
    active: boolean,
  ): Promise<ConversationDTO> {
    const conversation = await this.load(conversationId);
    if (conversation.type !== 'PET_OWNER_CLINIC') {
      throw new BadRequestError('Only a pet owner ↔ clinic conversation can be paused');
    }
    const side = await this.assertAccess(actor.actorUserId, conversation);
    if (side !== 'CLINIC') {
      throw new ForbiddenError('Only the clinic can pause or resume this conversation', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
    const status = active ? 'OPEN' : 'CLOSED';
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

    const unread = await this.unreadForSlice(userId, pageSlice);

    const items = pageSlice.map((x) =>
      this.toDTO(x.conversation, x.side, unread.get(x.conversation.id) ?? 0, userId),
    );
    return { items, total };
  }

  /**
   * Badge counts for the caller's conversations (optionally one organization's
   * — the clinic / office dashboard "messages" counter): conversations with
   * anything unread + total unread messages. Same access scoping as the list.
   */
  async unreadSummary(
    userId: string,
    filter: { organizationId?: string },
  ): Promise<{ unreadConversations: number; unreadMessages: number }> {
    const candidates = await this.conversations.listCandidatesForUser(userId, {
      organizationId: filter.organizationId,
      limit: CANDIDATE_CEILING,
    });
    const accessible: Array<{ conversation: Conversation; side: ConversationSide }> = [];
    for (const conversation of candidates) {
      const side = await this.resolveSide(userId, conversation);
      if (side) accessible.push({ conversation, side });
    }
    const unread = await this.unreadForSlice(userId, accessible);
    let unreadConversations = 0;
    let unreadMessages = 0;
    for (const n of unread.values()) {
      if (n > 0) unreadConversations += 1;
      unreadMessages += n;
    }
    return { unreadConversations, unreadMessages };
  }

  /**
   * Unread per conversation. Participant sides use the read pointer; the
   * dynamic org side (clinic / office / syndicate members — no participant
   * row) uses the member's own unread CHAT_MESSAGE_RECEIVED alerts, which
   * `markRead` clears — so each member has a personal, accurate count.
   */
  private async unreadForSlice(
    userId: string,
    slice: Array<{ conversation: Conversation; side: ConversationSide }>,
  ): Promise<Map<string, number>> {
    const orgSide = slice.filter((x) => ORG_SIDES.has(x.side)).map((x) => x.conversation.id);
    const participant = slice.filter((x) => !ORG_SIDES.has(x.side)).map((x) => x.conversation.id);
    const [byPointer, byAlerts] = await Promise.all([
      this.conversations.unreadCounts(userId, participant),
      this.notificationReads
        ? this.notificationReads.countUnreadForEntities(userId, 'CONVERSATION', orgSide)
        : Promise.resolve(new Map<string, number>()),
    ]);
    return new Map([...byPointer, ...byAlerts]);
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
    return { items: await Promise.all(items.map((m) => this.messageDto(m))), total };
  }

  // --- writes --------------------------------------------------------

  /**
   * Send a text and/or one attachment. An attachment must first be uploaded via
   * {@link requestAttachmentUpload}; here it is verified (same conversation,
   * real object, verified type + size, not linked elsewhere) before the row is
   * written. Text may be empty only when an attachment is present.
   */
  async sendMessage(
    actor: ChatActor,
    conversationId: string,
    input:
      | string
      | {
          body?: string;
          attachment?: { kind: ChatAttachmentKind; storageKey: string; fileName: string };
        },
  ): Promise<MessageDTO> {
    const { body = '', attachment: attachmentInput } =
      typeof input === 'string' ? { body: input, attachment: undefined } : input;
    const conversation = await this.load(conversationId);
    const side = await this.assertAccess(actor.actorUserId, conversation);
    await this.assertWritable(conversation);

    if (!body.trim() && !attachmentInput) {
      throw new BadRequestError('A message needs text or an attachment');
    }
    const attachment = attachmentInput
      ? await this.requireMedia().verify(conversation.id, attachmentInput, (key) =>
          this.messages.attachmentKeyInUse(key),
        )
      : null;

    const now = new Date();
    const message = await this.db.transaction(async (tx) => {
      const created = await this.messages.create(
        {
          conversationId: conversation.id,
          senderUserId: actor.actorUserId,
          body: body.trim(),
          type: 'TEXT',
          attachment,
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
    return this.messageDto(message);
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
    // Reading the conversation also clears its message alerts in the bell —
    // for every side, including clinic/office members (no participant row).
    await this.notificationReads?.markReadForEntity(userId, 'CONVERSATION', conversation.id);
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
    if (message.deletedAt) return this.messageDto(message);

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
    // The attachment is gone with the message — remove the object (best effort;
    // the DTO already hides it, so a failed delete only leaves an orphan).
    if (updated.attachment && this.media) {
      try {
        await this.media.deleteObject(updated.attachment.storageKey);
      } catch (err) {
        this.log.error({ err, messageId }, 'failed to delete chat attachment object');
      }
    }
    return this.messageDto(updated);
  }

  // --- DTO assembly -------------------------------------------------

  private toDTO(
    conversation: Conversation,
    side: ConversationSide,
    unreadCount: number | null,
    viewerUserId: string | null = null,
  ): ConversationDTO {
    let counterpartUserId: string | null;
    if (
      conversation.type === 'PET_OWNER_CLINIC' ||
      conversation.type === 'PET_OWNER_VETERINARY_OFFICE' ||
      conversation.type === 'SYNDICATE_MEMBER'
    ) {
      counterpartUserId = conversation.petOwnerUserId;
    } else if (conversation.type === 'PET_OWNER_VETERINARIAN') {
      counterpartUserId =
        side === 'PET_OWNER' ? conversation.veterinarianUserId : conversation.petOwnerUserId;
    } else if (conversation.type === 'ANIMAL_PUBLICATION') {
      counterpartUserId =
        side === 'PET_OWNER' ? conversation.memberUserId : conversation.petOwnerUserId;
    } else if (conversation.type === 'FARM_MEMBER_DIRECT') {
      // The OTHER colleague — `viewerUserId` tells which of the two is asking.
      counterpartUserId =
        viewerUserId === conversation.petOwnerUserId
          ? conversation.memberUserId
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
    const unread = await this.unreadForSlice(userId, [{ conversation, side }]);
    return this.toDTO(conversation, side, unread.get(conversation.id) ?? 0, userId);
  }
}
