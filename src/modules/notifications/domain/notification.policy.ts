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
  support: ThreadRepository;
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
  SUPPORT_CREATED: { title: 'New support message', body: 'A new support message was submitted.' },
  SUPPORT_MESSAGE_RECEIVED: {
    title: 'New support reply',
    body: 'There is a new message on a support request.',
  },
  SUPPORT_CLOSED: {
    title: 'Support request closed',
    body: 'Your support request has been closed.',
  },
  VET_SERVICE_LISTING_SUBMITTED: {
    title: 'New service listing to review',
    body: 'A veterinarian submitted a service listing for approval.',
  },
  VET_SERVICE_LISTING_APPROVED: {
    title: 'Service listing approved',
    body: 'Your service listing is now public.',
  },
  VET_SERVICE_LISTING_REJECTED: {
    title: 'Service listing rejected',
    body: 'Your service listing needs changes before it can be published.',
  },
  VET_SERVICE_REQUEST_SUBMITTED: {
    title: 'New service request to review',
    body: 'A pet owner submitted a service request for approval.',
  },
  VET_SERVICE_REQUEST_APPROVED: {
    title: 'Service request approved',
    body: 'Your service request is now public.',
  },
  VET_SERVICE_REQUEST_REJECTED: {
    title: 'Service request rejected',
    body: 'Your service request needs changes before it can be published.',
  },
  VET_SERVICE_OFFER_RECEIVED: {
    title: 'New offer on your request',
    body: 'A veterinarian submitted an offer on your service request.',
  },
  VET_SERVICE_OFFER_ACCEPTED: {
    title: 'Your offer was accepted',
    body: 'The pet owner accepted your offer — a conversation is open.',
  },
  VET_SERVICE_OFFER_REJECTED: {
    title: 'Your offer was declined',
    body: 'The pet owner chose a different offer.',
  },
  VET_SERVICE_LISTING_REQUEST_RECEIVED: {
    title: 'New request on your service',
    body: 'A pet owner requested your service listing.',
  },
  VET_SERVICE_LISTING_REQUEST_ACCEPTED: {
    title: 'Your request was accepted',
    body: 'The veterinarian accepted your request — a conversation is open.',
  },
  VET_SERVICE_LISTING_REQUEST_REJECTED: {
    title: 'Your request was declined',
    body: 'The veterinarian declined your service request.',
  },
  VET_SERVICE_DEAL_COMPLETED: {
    title: 'Service completed',
    body: 'The service has been marked as completed.',
  },
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
  CLINIC_APPOINTMENT_REQUESTED: {
    title: 'New appointment request',
    body: 'A pet owner has requested an appointment.',
  },
  CLINIC_APPOINTMENT_CONFIRMED: {
    title: 'Appointment confirmed',
    body: 'The clinic confirmed your appointment.',
  },
  CLINIC_APPOINTMENT_REJECTED: {
    title: 'Appointment declined',
    body: 'The clinic declined your appointment request.',
  },
  CLINIC_APPOINTMENT_RESCHEDULE_PROPOSED: {
    title: 'New appointment time proposed',
    body: 'The clinic proposed a different date/time for your appointment.',
  },
  CLINIC_APPOINTMENT_CANCELLED: {
    title: 'Appointment cancelled',
    body: 'An appointment was cancelled.',
  },
  CLINIC_APPOINTMENT_COMPLETED: {
    title: 'Appointment completed',
    body: 'Your appointment has been marked as completed.',
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

      case 'support.created':
        return this.threadCreated('SUPPORT', 'SUPPORT_CREATED', p);
      case 'support.message.created':
        return this.threadMessage('SUPPORT', 'SUPPORT_MESSAGE_RECEIVED', p);
      case 'support.closed':
        return this.threadClosed('SUPPORT', 'SUPPORT_CLOSED', p);

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

      // --- clinic appointments (Pet Owner ↔ Clinic booking) ---
      case 'clinic.appointment.requested':
        return this.clinicAppointmentToClinic('CLINIC_APPOINTMENT_REQUESTED', event.name, p);
      case 'clinic.appointment.reschedule_accepted':
      case 'clinic.appointment.reschedule_declined':
        return this.clinicAppointmentToClinic('CLINIC_APPOINTMENT_CONFIRMED', event.name, p);
      case 'clinic.appointment.cancelled':
        // The pet owner cancelled → tell the clinic; the clinic cancelled →
        // tell the pet owner.
        return str(p.actorUserId) === str(p.petOwnerUserId)
          ? this.clinicAppointmentToClinic('CLINIC_APPOINTMENT_CANCELLED', event.name, p)
          : this.clinicAppointmentToOwner('CLINIC_APPOINTMENT_CANCELLED', event.name, p);
      case 'clinic.appointment.confirmed':
        return this.clinicAppointmentToOwner('CLINIC_APPOINTMENT_CONFIRMED', event.name, p);
      case 'clinic.appointment.rejected':
        return this.clinicAppointmentToOwner('CLINIC_APPOINTMENT_REJECTED', event.name, p);
      case 'clinic.appointment.reschedule_proposed':
        return this.clinicAppointmentToOwner(
          'CLINIC_APPOINTMENT_RESCHEDULE_PROPOSED',
          event.name,
          p,
        );
      case 'clinic.appointment.completed':
        return this.clinicAppointmentToOwner('CLINIC_APPOINTMENT_COMPLETED', event.name, p);

      // --- Veterinary Services marketplace ---
      case 'vet_service.listing.submitted':
        return this.vetServiceToSupervisors(
          'VET_SERVICE_LISTING_SUBMITTED',
          event.name,
          str(p.listingId),
          'VET_SERVICE_LISTING',
          str(p.veterinarianUserId),
        );
      case 'vet_service.request.submitted':
        return this.vetServiceToSupervisors(
          'VET_SERVICE_REQUEST_SUBMITTED',
          event.name,
          str(p.requestId),
          'VET_SERVICE_REQUEST',
          str(p.petOwnerUserId),
        );
      case 'vet_service.listing.approved':
        return this.vetServiceToUser('VET_SERVICE_LISTING_APPROVED', event.name, p, {
          userId: str(p.veterinarianUserId),
          entityType: 'VET_SERVICE_LISTING',
          entityId: str(p.listingId),
        });
      case 'vet_service.listing.rejected':
        return this.vetServiceToUser('VET_SERVICE_LISTING_REJECTED', event.name, p, {
          userId: str(p.veterinarianUserId),
          entityType: 'VET_SERVICE_LISTING',
          entityId: str(p.listingId),
        });
      case 'vet_service.request.approved':
        return this.vetServiceToUser('VET_SERVICE_REQUEST_APPROVED', event.name, p, {
          userId: str(p.petOwnerUserId),
          entityType: 'VET_SERVICE_REQUEST',
          entityId: str(p.requestId),
        });
      case 'vet_service.request.rejected':
        return this.vetServiceToUser('VET_SERVICE_REQUEST_REJECTED', event.name, p, {
          userId: str(p.petOwnerUserId),
          entityType: 'VET_SERVICE_REQUEST',
          entityId: str(p.requestId),
        });
      case 'vet_service.offer.received':
        return this.vetServiceToUser('VET_SERVICE_OFFER_RECEIVED', event.name, p, {
          userId: str(p.petOwnerUserId),
          actorUserId: str(p.veterinarianUserId),
          entityType: 'VET_SERVICE_OFFER',
          entityId: str(p.offerId),
        });
      case 'vet_service.offer.accepted':
        return this.vetServiceToUser('VET_SERVICE_OFFER_ACCEPTED', event.name, p, {
          userId: str(p.veterinarianUserId),
          actorUserId: str(p.petOwnerUserId),
          entityType: 'VET_SERVICE_OFFER',
          entityId: str(p.offerId),
        });
      case 'vet_service.offer.rejected':
        return this.vetServiceToUser('VET_SERVICE_OFFER_REJECTED', event.name, p, {
          userId: str(p.veterinarianUserId),
          entityType: 'VET_SERVICE_OFFER',
          entityId: str(p.offerId),
        });
      case 'vet_service.listing_request.received':
        return this.vetServiceToUser('VET_SERVICE_LISTING_REQUEST_RECEIVED', event.name, p, {
          userId: str(p.veterinarianUserId),
          actorUserId: str(p.petOwnerUserId),
          entityType: 'VET_SERVICE_LISTING_REQUEST',
          entityId: str(p.listingRequestId),
        });
      case 'vet_service.listing_request.accepted':
        return this.vetServiceToUser('VET_SERVICE_LISTING_REQUEST_ACCEPTED', event.name, p, {
          userId: str(p.petOwnerUserId),
          actorUserId: str(p.veterinarianUserId),
          entityType: 'VET_SERVICE_LISTING_REQUEST',
          entityId: str(p.listingRequestId),
        });
      case 'vet_service.listing_request.rejected':
        return this.vetServiceToUser('VET_SERVICE_LISTING_REQUEST_REJECTED', event.name, p, {
          userId: str(p.petOwnerUserId),
          entityType: 'VET_SERVICE_LISTING_REQUEST',
          entityId: str(p.listingRequestId),
        });
      case 'vet_service.deal.completed':
        return this.vetServiceDealCompleted(event.name, p);

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
    if (conv.type === 'PET_OWNER_VETERINARIAN') {
      // Direct 1:1 marketplace deal — the other participant.
      for (const id of [conv.petOwnerUserId, conv.veterinarianUserId]) {
        if (id && id !== sender) recipients.add(id);
      }
    } else if (conv.type === 'FARM_OWNER_MEMBER') {
      const org = conv.organizationId
        ? await this.deps.organizations.findById(conv.organizationId)
        : null;
      for (const id of [org?.ownerUserId, conv.memberUserId]) {
        if (id && id !== sender) recipients.add(id);
      }
    } else if (conv.organizationId) {
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
    const repo =
      domain === 'CONSULTATION'
        ? this.deps.consultations
        : domain === 'INQUIRY'
          ? this.deps.inquiries
          : this.deps.support;
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

  /**
   * "حجز موعد" — notify the CLINIC side (every ACTIVE member of the clinic
   * organization, minus the actor) about a pet-owner-driven change.
   */
  private async clinicAppointmentToClinic(
    type: NotificationType,
    eventName: string,
    p: P,
  ): Promise<NotificationSpec[]> {
    const organizationId = str(p.organizationId);
    const appointmentId = str(p.appointmentId);
    const actor = str(p.actorUserId);
    if (!organizationId || !appointmentId) return [];

    const { items } = await this.deps.memberships.listForOrg(organizationId, {
      page: 1,
      pageSize: RECIPIENT_FANOUT_CAP,
      status: 'ACTIVE',
    });
    const key = `${eventName}:${appointmentId}`;
    return items
      .filter((m) => m.userId !== actor)
      .map((m) =>
        this.spec(
          type,
          m.userId,
          { organizationId, appointmentId },
          {
            actorUserId: actor || null,
            entityType: 'CLINIC_APPOINTMENT',
            entityId: appointmentId,
            sourceEventKey: key,
          },
        ),
      );
  }

  /** Notify the PET OWNER about a clinic-driven appointment decision. */
  private clinicAppointmentToOwner(
    type: NotificationType,
    eventName: string,
    p: P,
  ): NotificationSpec[] {
    const owner = str(p.petOwnerUserId);
    const appointmentId = str(p.appointmentId);
    const actor = str(p.actorUserId);
    if (!owner || !appointmentId || owner === actor) return [];
    return [
      this.spec(
        type,
        owner,
        { organizationId: str(p.organizationId), appointmentId },
        {
          actorUserId: actor || null,
          entityType: 'CLINIC_APPOINTMENT',
          entityId: appointmentId,
          sourceEventKey: `${eventName}:${appointmentId}`,
        },
      ),
    ];
  }

  private async threadClosed(
    domain: string,
    type: NotificationType,
    p: P,
  ): Promise<NotificationSpec[]> {
    const repo =
      domain === 'CONSULTATION'
        ? this.deps.consultations
        : domain === 'INQUIRY'
          ? this.deps.inquiries
          : this.deps.support;
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

  // --- Veterinary Services marketplace ---------------------------

  /** A new listing / request submission → the VET_SERVICE moderators. */
  private async vetServiceToSupervisors(
    type: NotificationType,
    eventName: string,
    entityId: string,
    entityType: string,
    excludeUserId: string,
  ): Promise<NotificationSpec[]> {
    if (!entityId) return [];
    const supIds = await this.activeSupervisorUserIds('VET_SERVICE');
    return supIds
      .filter((id) => id !== excludeUserId)
      .map((uid) =>
        this.spec(
          type,
          uid,
          { entityId },
          { entityType, entityId, sourceEventKey: `${eventName}:${entityId}` },
        ),
      );
  }

  private vetServiceToUser(
    type: NotificationType,
    eventName: string,
    p: P,
    opts: { userId: string; actorUserId?: string; entityType: string; entityId: string },
  ): NotificationSpec[] {
    if (!opts.userId || !opts.entityId) return [];
    if (opts.actorUserId && opts.actorUserId === opts.userId) return [];
    return [
      this.spec(
        type,
        opts.userId,
        { entityId: opts.entityId, ...(str(p.conversationId) ? { conversationId: str(p.conversationId) } : {}) },
        {
          actorUserId: opts.actorUserId ?? null,
          entityType: opts.entityType,
          entityId: opts.entityId,
          sourceEventKey: `${eventName}:${opts.entityId}`,
        },
      ),
    ];
  }

  /** "إنهاء الطلب" — notify the party that did NOT complete it. */
  private vetServiceDealCompleted(eventName: string, p: P): NotificationSpec[] {
    const actor = str(p.actorUserId);
    const subjectId = str(p.subjectId);
    if (!subjectId) return [];
    const recipients = [str(p.petOwnerUserId), str(p.veterinarianUserId)].filter(
      (id) => id && id !== actor,
    );
    return recipients.map((uid) =>
      this.spec(
        'VET_SERVICE_DEAL_COMPLETED',
        uid,
        { entityId: subjectId, subjectType: str(p.subjectType) },
        {
          actorUserId: actor || null,
          entityType: str(p.subjectType) || 'VET_SERVICE_DEAL',
          entityId: subjectId,
          sourceEventKey: `${eventName}:${subjectId}`,
        },
      ),
    );
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
