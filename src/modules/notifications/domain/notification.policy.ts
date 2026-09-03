import type { DomainEvent } from '../../../shared/events/index.js';
import type { ConversationRepository } from '../../chat/infrastructure/conversation.repository.js';
import type { ThreadRepository } from '../../consultations/infrastructure/thread.repository.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type { SupervisorRepository } from '../../supervisors/supervisor.repository.js';
import type { NotificationType } from './notification.constants.js';
import type { NotificationSpec } from './notification.types.js';

export interface NotificationPolicyDeps {
  conversations: ConversationRepository;
  consultations: ThreadRepository;
  inquiries: ThreadRepository;
  memberships: MembershipRepository;
  organizations: OrganizationRepository;
  supervisors: SupervisorRepository;
}

/** Fan-out cap for a single domain event (clinic staff / domain supervisors). */
const RECIPIENT_FANOUT_CAP = 200;

const COPY: Record<NotificationType, { title: string; body: string }> = {
  ACCOUNT_STATUS_CHANGED: {
    title: 'Account status changed',
    body: 'Your account status was updated.',
  },
  ORGANIZATION_APPROVED: {
    title: 'Organization approved',
    body: 'Your organization has been approved.',
  },
  ORGANIZATION_REJECTED: {
    title: 'Organization rejected',
    body: 'Your organization request was rejected.',
  },
  ORGANIZATION_SUSPENDED: {
    title: 'Organization suspended',
    body: 'Your organization has been suspended.',
  },
  ORGANIZATION_ACTIVATED: {
    title: 'Organization activated',
    body: 'Your organization has been re-activated.',
  },
  ORGANIZATION_MEMBER_ADDED: {
    title: 'Added to an organization',
    body: 'You were added to an organization.',
  },
  ORGANIZATION_MEMBER_REMOVED: {
    title: 'Removed from an organization',
    body: 'You were removed from an organization.',
  },
  ORGANIZATION_SUPERVISOR_ASSIGNED: {
    title: 'Supervisor assignment',
    body: 'You were assigned as an organization supervisor.',
  },
  SYSTEM_SUPERVISOR_ASSIGNED: {
    title: 'Supervisor assignment',
    body: 'You were assigned as a system supervisor.',
  },
  CHAT_MESSAGE_RECEIVED: { title: 'New message', body: 'You have a new message.' },
  CONSULTATION_CREATED: { title: 'New consultation', body: 'A new consultation was submitted.' },
  CONSULTATION_MESSAGE_RECEIVED: {
    title: 'New consultation reply',
    body: 'There is a new message on a consultation.',
  },
  CONSULTATION_CLOSED: { title: 'Consultation closed', body: 'Your consultation has been closed.' },
  INQUIRY_CREATED: { title: 'New inquiry', body: 'A new inquiry was submitted.' },
  INQUIRY_MESSAGE_RECEIVED: {
    title: 'New inquiry reply',
    body: 'There is a new message on an inquiry.',
  },
  INQUIRY_CLOSED: { title: 'Inquiry closed', body: 'Your inquiry has been closed.' },
  CONTENT_PUBLISHED: { title: 'New content published', body: 'New content is available.' },
  ADMIN_ANNOUNCEMENT: { title: 'Announcement', body: 'You have a new announcement.' },
  PUBLICATION_ADOPTION_REQUESTED: {
    title: 'Adoption request',
    body: 'Someone is interested in adopting your listed animal.',
  },
  PUBLICATION_MATING_REQUESTED: {
    title: 'Mating request',
    body: 'Someone is interested in mating with your listed animal.',
  },
  PUBLICATION_SIGHTING_REPORTED: {
    title: 'Sighting reported',
    body: 'Someone reported a sighting of your lost animal.',
  },
  TRANSFER_REQUEST_RECEIVED: {
    title: 'Ownership transfer request',
    body: 'Someone wants to transfer an animal to you.',
  },
  TRANSFER_REQUEST_ACCEPTED: {
    title: 'Transfer request accepted',
    body: 'Your ownership transfer request was accepted.',
  },
  TRANSFER_REQUEST_REJECTED: {
    title: 'Transfer request declined',
    body: 'Your ownership transfer request was declined.',
  },
};

type P = Record<string, unknown>;

/**
 * The single place that maps a domain event → notification targets. Domain
 * modules never do recipient resolution. Every mapper:
 *  - excludes the actor / sender,
 *  - resolves recipients from CURRENT domain relationships (membership,
 *    supervisor assignment, thread ownership),
 *  - attaches ids-only `data` (no private message content),
 *  - sets a deterministic `sourceEventKey` for idempotency.
 *
 * An event with no mapper produces no notification.
 */
export class NotificationPolicy {
  constructor(private readonly deps: NotificationPolicyDeps) {}

  async resolve(event: DomainEvent): Promise<NotificationSpec[]> {
    const p = event.payload as P;
    switch (event.name) {
      case 'organization.approved':
        return this.singleOwner(
          'ORGANIZATION_APPROVED',
          p,
          `${event.name}:${str(p.organizationId)}`,
        );
      case 'organization.rejected':
        return this.singleOwner(
          'ORGANIZATION_REJECTED',
          p,
          `${event.name}:${str(p.organizationId)}`,
        );
      case 'organization.suspended':
        return this.singleOwner(
          'ORGANIZATION_SUSPENDED',
          p,
          `${event.name}:${str(p.organizationId)}`,
        );
      case 'organization.activated':
        return this.singleOwner(
          'ORGANIZATION_ACTIVATED',
          p,
          `${event.name}:${str(p.organizationId)}`,
        );

      case 'organization.member.added':
        return this.toUser('ORGANIZATION_MEMBER_ADDED', str(p.userId), {
          organizationId: str(p.organizationId),
          entityType: 'ORGANIZATION',
          entityId: str(p.organizationId),
          key: `${event.name}:${str(p.organizationId)}:${str(p.userId)}`,
        });
      case 'organization.member.removed':
        // Self-initiated leave → no notification.
        if (p.reason === 'left') return [];
        return this.toUser('ORGANIZATION_MEMBER_REMOVED', str(p.userId), {
          organizationId: str(p.organizationId),
          entityType: 'ORGANIZATION',
          entityId: str(p.organizationId),
          key: `${event.name}:${str(p.organizationId)}:${str(p.userId)}`,
        });
      case 'organization.supervisor.assigned':
        return this.toUser('ORGANIZATION_SUPERVISOR_ASSIGNED', str(p.userId), {
          organizationId: str(p.organizationId),
          entityType: 'ORGANIZATION',
          entityId: str(p.organizationId),
          key: `${event.name}:${str(p.membershipId)}`,
        });
      case 'supervisor.assigned':
        return this.toUser('SYSTEM_SUPERVISOR_ASSIGNED', str(p.userId), {
          domain: str(p.domain),
          key: `${event.name}:${str(p.assignmentId)}`,
        });

      case 'chat.message.created':
        return this.chatMessage(p);

      case 'consultation.created':
        return this.threadCreated('CONSULTATION', 'CONSULTATION_CREATED', p);
      case 'inquiry.created':
        return this.threadCreated('INQUIRY', 'INQUIRY_CREATED', p);
      case 'consultation.message.created':
        return this.threadMessage('CONSULTATION', 'CONSULTATION_MESSAGE_RECEIVED', p);
      case 'inquiry.message.created':
        return this.threadMessage('INQUIRY', 'INQUIRY_MESSAGE_RECEIVED', p);
      case 'consultation.closed':
        return this.threadClosed('CONSULTATION', 'CONSULTATION_CLOSED', p);
      case 'inquiry.closed':
        return this.threadClosed('INQUIRY', 'INQUIRY_CLOSED', p);

      case 'animal.publication.interaction.created':
        return this.publicationInteraction(p);

      case 'animal.transfer.requested':
        return this.toUser('TRANSFER_REQUEST_RECEIVED', str(p.toUserId), {
          animalId: str(p.animalId),
          entityType: 'ANIMAL_TRANSFER_REQUEST',
          entityId: str(p.requestId),
          key: `${event.name}:${str(p.requestId)}`,
        });
      case 'animal.transfer.accepted':
        return this.toUser('TRANSFER_REQUEST_ACCEPTED', str(p.fromUserId), {
          animalId: str(p.animalId),
          entityType: 'ANIMAL_TRANSFER_REQUEST',
          entityId: str(p.requestId),
          key: `${event.name}:${str(p.requestId)}`,
        });
      case 'animal.transfer.rejected':
        return this.toUser('TRANSFER_REQUEST_REJECTED', str(p.fromUserId), {
          animalId: str(p.animalId),
          entityType: 'ANIMAL_TRANSFER_REQUEST',
          entityId: str(p.requestId),
          key: `${event.name}:${str(p.requestId)}`,
        });

      default:
        return [];
    }
  }

  // --- builders ------------------------------------------------

  private spec(
    type: NotificationType,
    recipientUserId: string,
    data: Record<string, string>,
    extra: {
      actorUserId?: string | null;
      entityType?: string | null;
      entityId?: string | null;
      sourceEventKey?: string | null;
    },
  ): NotificationSpec {
    return {
      recipientUserId,
      type,
      title: COPY[type].title,
      body: COPY[type].body,
      data: { type, ...data },
      actorUserId: extra.actorUserId ?? null,
      entityType: extra.entityType ?? null,
      entityId: extra.entityId ?? null,
      sourceEventKey: extra.sourceEventKey ?? null,
      push: true,
    };
  }

  private singleOwner(type: NotificationType, p: P, key: string): NotificationSpec[] {
    const owner = str(p.ownerUserId);
    if (!owner) return [];
    return [
      this.spec(
        type,
        owner,
        { organizationId: str(p.organizationId) },
        {
          entityType: 'ORGANIZATION',
          entityId: str(p.organizationId),
          sourceEventKey: key,
        },
      ),
    ];
  }

  private toUser(
    type: NotificationType,
    userId: string,
    opts: { key: string; entityType?: string; entityId?: string } & Record<string, string>,
  ): NotificationSpec[] {
    if (!userId) return [];
    const { key, entityType, entityId, ...data } = opts;
    return [this.spec(type, userId, data, { entityType, entityId, sourceEventKey: key })];
  }

  private async activeSupervisorUserIds(domain: string): Promise<string[]> {
    const { items } = await this.deps.supervisors.list({
      page: 1,
      pageSize: RECIPIENT_FANOUT_CAP,
      domain: domain as never,
      status: 'ACTIVE',
    });
    return items.map((a) => a.userId);
  }

  private async chatMessage(p: P): Promise<NotificationSpec[]> {
    const conversationId = str(p.conversationId);
    const messageId = str(p.messageId);
    const sender = str(p.senderUserId);
    const conv = await this.deps.conversations.findById(conversationId);
    if (!conv) return [];

    const recipients = new Set<string>();
    if (conv.type === 'FARM_OWNER_MEMBER') {
      const org = await this.deps.organizations.findById(conv.organizationId);
      for (const id of [org?.ownerUserId, conv.memberUserId]) {
        if (id && id !== sender) recipients.add(id);
      }
    } else {
      // PET_OWNER_CLINIC
      if (sender === conv.petOwnerUserId) {
        const { items } = await this.deps.memberships.listForOrg(conv.organizationId, {
          page: 1,
          pageSize: RECIPIENT_FANOUT_CAP,
          status: 'ACTIVE',
        });
        for (const m of items) if (m.userId !== sender) recipients.add(m.userId);
      } else if (conv.petOwnerUserId && conv.petOwnerUserId !== sender) {
        recipients.add(conv.petOwnerUserId);
      }
    }

    return [...recipients].map((uid) =>
      this.spec(
        'CHAT_MESSAGE_RECEIVED',
        uid,
        { conversationId, messageId },
        {
          actorUserId: sender || null,
          entityType: 'CONVERSATION',
          entityId: conversationId,
          sourceEventKey: `chat.message.created:${messageId}`,
        },
      ),
    );
  }

  private async threadCreated(
    domain: string,
    type: NotificationType,
    p: P,
  ): Promise<NotificationSpec[]> {
    const threadId = str(p[`${domain.toLowerCase()}Id`]);
    const creator = str(p.createdByUserId);
    const supIds = await this.activeSupervisorUserIds(domain);
    const key = `${domain.toLowerCase()}.created:${threadId}`;
    return supIds
      .filter((id) => id !== creator)
      .map((uid) =>
        this.spec(
          type,
          uid,
          { [`${domain.toLowerCase()}Id`]: threadId },
          {
            entityType: domain,
            entityId: threadId,
            sourceEventKey: key,
          },
        ),
      );
  }

  private async threadMessage(
    domain: string,
    type: NotificationType,
    p: P,
  ): Promise<NotificationSpec[]> {
    const repo = domain === 'CONSULTATION' ? this.deps.consultations : this.deps.inquiries;
    const idField = `${domain.toLowerCase()}Id`;
    const threadId = str(p[idField]);
    const messageId = str(p.messageId);
    const source = str(p.source);
    const thread = await repo.findById(threadId);
    if (!thread) return [];

    let recipients: string[];
    if (source === 'USER') {
      // the creator posted → notify the responsible domain supervisors
      recipients = (await this.activeSupervisorUserIds(domain)).filter(
        (id) => id !== thread.createdByUserId,
      );
    } else {
      // SUPERVISOR / ADMIN / AI responded → notify the creator
      recipients = [thread.createdByUserId];
    }

    const key = `${domain.toLowerCase()}.message.created:${messageId}`;
    return recipients.map((uid) =>
      this.spec(
        type,
        uid,
        { [idField]: threadId, messageId },
        {
          entityType: domain,
          entityId: threadId,
          sourceEventKey: key,
        },
      ),
    );
  }

  /**
   * "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" — notify the listing owner.
   * No repository lookup needed: the event payload already carries the owner
   * id (`PublicationInteractionService` resolved it via the ownership guard).
   */
  private publicationInteraction(p: P): NotificationSpec[] {
    const owner = str(p.publicationOwnerUserId);
    const requester = str(p.requesterUserId);
    const publicationId = str(p.publicationId);
    const interactionId = str(p.interactionId);
    if (!owner) return [];

    const type: NotificationType =
      p.type === 'SIGHTING'
        ? 'PUBLICATION_SIGHTING_REPORTED'
        : p.kind === 'MATING'
          ? 'PUBLICATION_MATING_REQUESTED'
          : 'PUBLICATION_ADOPTION_REQUESTED';

    return [
      this.spec(
        type,
        owner,
        { publicationId },
        {
          actorUserId: requester || null,
          entityType: 'ANIMAL_PUBLICATION',
          entityId: publicationId,
          sourceEventKey: `animal.publication.interaction.created:${interactionId}`,
        },
      ),
    ];
  }

  private async threadClosed(
    domain: string,
    type: NotificationType,
    p: P,
  ): Promise<NotificationSpec[]> {
    const repo = domain === 'CONSULTATION' ? this.deps.consultations : this.deps.inquiries;
    const idField = `${domain.toLowerCase()}Id`;
    const threadId = str(p[idField]);
    const thread = await repo.findById(threadId);
    if (!thread) return [];
    return [
      this.spec(
        type,
        thread.createdByUserId,
        { [idField]: threadId },
        {
          entityType: domain,
          entityId: threadId,
          sourceEventKey: `${domain.toLowerCase()}.closed:${threadId}`,
        },
      ),
    ];
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
