import type { DomainEvent } from '../../../shared/events/index.js';
import type { ConversationRepository } from '../../chat/infrastructure/conversation.repository.js';
import type { ThreadRepository } from '../../consultations/infrastructure/thread.repository.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationFollowRepository } from '../../organizations/infrastructure/organization-follow.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type { SupervisorRepository } from '../../supervisors/supervisor.repository.js';
import type { NotificationRecipientRepository } from '../infrastructure/recipient.repository.js';
import type { NotificationType } from './notification.constants.js';
import { NOTIFICATION_COPY } from './notification.copy.js';
import type { NotificationSpec } from './notification.types.js';

export interface NotificationPolicyDeps {
  conversations: ConversationRepository;
  consultations: ThreadRepository;
  inquiries: ThreadRepository;
  support: ThreadRepository;
  memberships: MembershipRepository;
  organizations: OrganizationRepository;
  supervisors: SupervisorRepository;
  organizationFollows: OrganizationFollowRepository;
  recipients: NotificationRecipientRepository;
}

/** Fan-out cap for a single domain event (clinic staff / domain supervisors). */
const RECIPIENT_FANOUT_CAP = 200;

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

      // --- Veterinarian Courses & Seminars ---
      case 'vet_course.submitted':
        return this.vetCourseToSupervisors(
          'VET_COURSE_SUBMITTED',
          event.name,
          str(p.courseId),
          'VET_COURSE',
          str(p.creatorUserId),
        );
      case 'vet_course.approved':
        return this.vetServiceToUser('VET_COURSE_APPROVED', event.name, p, {
          userId: str(p.creatorUserId),
          entityType: 'VET_COURSE',
          entityId: str(p.courseId),
        });
      case 'vet_course.rejected':
        return this.vetServiceToUser('VET_COURSE_REJECTED', event.name, p, {
          userId: str(p.creatorUserId),
          entityType: 'VET_COURSE',
          entityId: str(p.courseId),
        });
      case 'vet_course.registration.created':
        return this.vetCourseRegistration(event.name, p);

      // --- Veterinary Syndicates / Unions ---
      case 'syndicate.announcement.published':
        return this.syndicateFollowersToNotify(
          'SYNDICATE_ANNOUNCEMENT_PUBLISHED',
          event.name,
          str(p.organizationId),
          str(p.announcementId),
          str(p.actorUserId),
        );
      case 'syndicate.submission.created':
        return this.syndicateOrgMembers(
          'SYNDICATE_SUBMISSION_CREATED',
          event.name,
          str(p.organizationId),
          str(p.submissionId),
          str(p.submittedByUserId),
        );
      case 'syndicate.submission.responded':
        return this.vetServiceToUser('SYNDICATE_SUBMISSION_RESPONDED', event.name, p, {
          userId: str(p.submittedByUserId),
          actorUserId: str(p.actorUserId),
          entityType: 'SYNDICATE_SUBMISSION',
          entityId: str(p.submissionId),
        });

      // --- Organization → followers broadcast (Veterinary Office Dashboard) ---
      case 'organization.broadcast.sent':
        return this.organizationBroadcastToFollowers(
          event.name,
          str(p.organizationId),
          str(p.broadcastId),
          str(p.title),
          str(p.body),
          typeof p.imageUrl === 'string' ? p.imageUrl : null,
          str(p.actorUserId),
        );

      // --- account -------------------------------------------------
      case 'user.status.changed':
        return this.userStatusChanged(event, p);

      // --- veterinarian approval workflow ----------------------------
      case 'veterinarian.application.submitted':
        return this.toReviewers('VETERINARIAN_APPLICATION_SUBMITTED', null, {
          excludeUserId: str(p.userId),
          data: { applicationId: str(p.applicationId), applicantUserId: str(p.userId) },
          entityType: 'VETERINARIAN_APPLICATION',
          entityId: str(p.applicationId),
          key: `${event.name}:${str(p.applicationId)}`,
        });
      case 'veterinarian.approved':
      case 'veterinarian.rejected':
        return this.toUser(
          event.name === 'veterinarian.approved'
            ? 'VETERINARIAN_APPROVED'
            : 'VETERINARIAN_REJECTED',
          str(p.userId),
          {
            applicationId: str(p.applicationId),
            entityType: 'VETERINARIAN_APPLICATION',
            entityId: str(p.applicationId),
            key: `${event.name}:${str(p.applicationId)}`,
          },
        );

      // --- organizations ---------------------------------------------
      case 'organization.created':
        return this.organizationSubmitted(event.name, p);
      case 'organization.deactivated':
        return this.singleOwner(
          'ORGANIZATION_DEACTIVATED',
          p,
          repeatableKey(event, str(p.organizationId)),
        );
      case 'organization.member.updated':
        if (str(p.actorUserId) === str(p.userId)) return [];
        return this.toUser('ORGANIZATION_ROLE_CHANGED', str(p.userId), {
          organizationId: str(p.organizationId),
          ...(str(p.roleKey) ? { roleKey: str(p.roleKey) } : {}),
          ...(str(p.status) ? { status: str(p.status) } : {}),
          entityType: 'ORGANIZATION',
          entityId: str(p.organizationId),
          key: repeatableKey(event, str(p.membershipId)),
        });

      // --- organization subscription (FARM / VETERINARY_OFFICE / CLINIC) ---
      case 'farm.subscription.set':
        return this.subscriptionToOwner(
          'SUBSCRIPTION_UPDATED',
          p,
          `${event.name}:${str(p.organizationId)}:${str(p.endDate)}`,
        );
      case 'farm.subscription.renewal.requested':
        return this.subscriptionRenewalRequested(event.name, p);
      case 'farm.subscription.renewal.approved':
        return this.subscriptionToOwner(
          'SUBSCRIPTION_RENEWAL_APPROVED',
          p,
          `${event.name}:${str(p.requestId)}`,
        );
      case 'farm.subscription.renewal.rejected':
        return this.subscriptionToOwner(
          'SUBSCRIPTION_RENEWAL_REJECTED',
          p,
          `${event.name}:${str(p.requestId)}`,
        );

      // --- farms -------------------------------------------------------
      case 'farm.member.joined':
        return this.farmMemberJoined(event.name, p);
      case 'farm.appointment.created':
        return this.farmAppointmentCreated(event.name, p);

      // --- poultry market traders -----------------------------------
      case 'trader.application.submitted':
        return this.toReviewers('TRADER_APPLICATION_SUBMITTED', 'MARKET', {
          excludeUserId: str(p.userId),
          data: { traderProfileId: str(p.traderProfileId) },
          entityType: 'TRADER_PROFILE',
          entityId: str(p.traderProfileId),
          key: repeatableKey(event, str(p.traderProfileId)),
        });
      case 'trader.approved':
      case 'trader.rejected':
      case 'trader.suspended':
      case 'trader.reactivated':
        return this.toUser(TRADER_TYPES[event.name] as NotificationType, str(p.userId), {
          entityType: 'TRADER_PROFILE',
          entityId: str(p.userId),
          key: repeatableKey(event, str(p.userId)),
        });

      // --- animal publications (lost / adoption / mating) moderation ---
      case 'animal.lost.created':
      case 'animal.adoption.created':
      case 'animal.mating.created':
        return this.toReviewers('PUBLICATION_SUBMITTED', 'ANIMAL', {
          excludeUserId: str(p.createdByUserId),
          data: { publicationId: str(p.publicationId), kind: str(p.kind) },
          entityType: 'ANIMAL_PUBLICATION',
          entityId: str(p.publicationId),
          key: `${event.name}:${str(p.publicationId)}`,
        });
      case 'animal.lost.approved':
      case 'animal.adoption.approved':
      case 'animal.mating.approved':
      case 'animal.lost.rejected':
      case 'animal.adoption.rejected':
      case 'animal.mating.rejected':
        if (str(p.actorUserId) === str(p.createdByUserId)) return [];
        return this.toUser(
          event.name.endsWith('.approved') ? 'PUBLICATION_APPROVED' : 'PUBLICATION_REJECTED',
          str(p.createdByUserId),
          {
            publicationId: str(p.publicationId),
            kind: str(p.kind),
            entityType: 'ANIMAL_PUBLICATION',
            entityId: str(p.publicationId),
            key: `${event.name}:${str(p.publicationId)}`,
          },
        );

      // --- Veterinarian Courses & Seminars (additions) ----------------
      case 'vet_course.cancelled':
        return this.vetCourseCancelled(event.name, p);

      // --- Veterinary Jobs ----------------------------------------------
      case 'vet_job.offer.submitted':
        return this.toReviewers('VET_JOB_OFFER_SUBMITTED', 'VET_JOBS', {
          excludeUserId: str(p.postedByUserId),
          data: { offerId: str(p.offerId) },
          entityType: 'VET_JOB_OFFER',
          entityId: str(p.offerId),
          key: repeatableKey(event, str(p.offerId)),
        });
      case 'vet_job.offer.approved':
      case 'vet_job.offer.rejected':
        if (str(p.actorUserId) === str(p.postedByUserId)) return [];
        return this.toUser(
          event.name === 'vet_job.offer.approved'
            ? 'VET_JOB_OFFER_APPROVED'
            : 'VET_JOB_OFFER_REJECTED',
          str(p.postedByUserId),
          {
            offerId: str(p.offerId),
            entityType: 'VET_JOB_OFFER',
            entityId: str(p.offerId),
            key: repeatableKey(event, str(p.offerId)),
          },
        );
      case 'vet_job.seeker_profile.submitted':
        return this.toReviewers('VET_JOB_SEEKER_PROFILE_SUBMITTED', 'VET_JOBS', {
          excludeUserId: str(p.userId),
          data: { profileId: str(p.profileId) },
          entityType: 'VET_JOB_SEEKER_PROFILE',
          entityId: str(p.profileId),
          key: repeatableKey(event, str(p.profileId)),
        });
      case 'vet_job.seeker_profile.approved':
      case 'vet_job.seeker_profile.rejected':
        if (str(p.actorUserId) === str(p.userId)) return [];
        return this.toUser(
          event.name === 'vet_job.seeker_profile.approved'
            ? 'VET_JOB_SEEKER_PROFILE_APPROVED'
            : 'VET_JOB_SEEKER_PROFILE_REJECTED',
          str(p.userId),
          {
            profileId: str(p.profileId),
            entityType: 'VET_JOB_SEEKER_PROFILE',
            entityId: str(p.profileId),
            key: repeatableKey(event, str(p.profileId)),
          },
        );
      case 'vet_job.application.received':
        return this.toUser('VET_JOB_APPLICATION_RECEIVED', str(p.posterUserId), {
          applicationId: str(p.applicationId),
          jobOfferId: str(p.jobOfferId),
          entityType: 'VET_JOB_APPLICATION',
          entityId: str(p.applicationId),
          key: `${event.name}:${str(p.applicationId)}`,
        });
      case 'vet_job.application.accepted':
      case 'vet_job.application.rejected':
        return this.toUser(
          event.name === 'vet_job.application.accepted'
            ? 'VET_JOB_APPLICATION_ACCEPTED'
            : 'VET_JOB_APPLICATION_REJECTED',
          str(p.applicantUserId),
          {
            applicationId: str(p.applicationId),
            jobOfferId: str(p.jobOfferId),
            ...(str(p.conversationId) ? { conversationId: str(p.conversationId) } : {}),
            entityType: 'VET_JOB_APPLICATION',
            entityId: str(p.applicationId),
            key: `${event.name}:${str(p.applicationId)}`,
          },
        );

      // --- platform store orders --------------------------------------
      case 'pet_store.order.placed':
      case 'veterinarian_store.order.placed': {
        const store = event.name.startsWith('pet_store') ? 'PET_OWNER_STORE' : 'VETERINARIAN_STORE';
        return this.toReviewers('STORE_ORDER_PLACED', store, {
          excludeUserId: str(p.userId),
          data: { orderId: str(p.orderId), store },
          entityType: 'STORE_ORDER',
          entityId: str(p.orderId),
          key: `${event.name}:${str(p.orderId)}`,
        });
      }
      case 'pet_store.order.status_changed':
      case 'veterinarian_store.order.status_changed': {
        const store = event.name.startsWith('pet_store') ? 'PET_OWNER_STORE' : 'VETERINARIAN_STORE';
        return this.toUser('STORE_ORDER_STATUS_CHANGED', str(p.userId), {
          orderId: str(p.orderId),
          store,
          status: str(p.status),
          entityType: 'STORE_ORDER',
          entityId: str(p.orderId),
          key: `${event.name}:${str(p.orderId)}:${str(p.status)}`,
        });
      }

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
      title: NOTIFICATION_COPY[type].title,
      body: NOTIFICATION_COPY[type].body,
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
    if (conv.type === 'CHAT_ROOM') {
      // Global Chat — every active, non-muted room member except the sender.
      const ids = await this.deps.conversations.listActiveParticipantUserIds(conversationId, {
        excludeUserId: sender,
        excludeMuted: true,
        limit: RECIPIENT_FANOUT_CAP,
      });
      for (const id of ids) recipients.add(id);
    } else if (conv.type === 'PET_OWNER_VETERINARIAN') {
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
          // `audience` lets the client route clinic staff vs the pet owner —
          // CONFIRMED / CANCELLED reach either side.
          { organizationId, appointmentId, audience: 'CLINIC' },
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
        { organizationId: str(p.organizationId), appointmentId, audience: 'OWNER' },
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

  private async vetCourseToSupervisors(
    type: NotificationType,
    eventName: string,
    entityId: string,
    entityType: string,
    excludeUserId: string,
  ): Promise<NotificationSpec[]> {
    if (!entityId) return [];
    const supIds = await this.activeSupervisorUserIds('VET_COURSES');
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

  /** Notify a syndicate's followers about a new announcement (excludes the poster). */
  private async syndicateFollowersToNotify(
    type: NotificationType,
    eventName: string,
    organizationId: string,
    announcementId: string,
    actorUserId: string,
  ): Promise<NotificationSpec[]> {
    if (!organizationId || !announcementId) return [];
    const followerIds = await this.deps.organizationFollows.listFollowerUserIds(
      organizationId,
      RECIPIENT_FANOUT_CAP,
    );
    const key = `${eventName}:${announcementId}`;
    return followerIds
      .filter((id) => id !== actorUserId)
      .map((uid) =>
        this.spec(
          type,
          uid,
          { organizationId, announcementId },
          {
            actorUserId: actorUserId || null,
            entityType: 'SYNDICATE_ANNOUNCEMENT',
            entityId: announcementId,
            sourceEventKey: key,
          },
        ),
      );
  }

  /**
   * Notify an organization's followers about a broadcast message (Veterinary Office
   * Dashboard "إرسال رسالة للمتابعين"). Unlike every other mapper, title/body are
   * SENDER-supplied, not a fixed `NOTIFICATION_COPY` string — built directly, bypassing `spec()`.
   * Not backed by a persisted entity (no "past broadcasts" screen exists — spec
   * intentionally scoped this as fire-and-forget); `broadcastId` is generated by
   * `OrganizationBroadcastService` per send purely to make `sourceEventKey` idempotent.
   */
  private async organizationBroadcastToFollowers(
    eventName: string,
    organizationId: string,
    broadcastId: string,
    title: string,
    body: string,
    imageUrl: string | null,
    actorUserId: string,
  ): Promise<NotificationSpec[]> {
    if (!organizationId || !broadcastId) return [];
    const followerIds = await this.deps.organizationFollows.listFollowerUserIds(
      organizationId,
      RECIPIENT_FANOUT_CAP,
    );
    const key = `${eventName}:${broadcastId}`;
    return followerIds
      .filter((id) => id !== actorUserId)
      .map((uid) => ({
        recipientUserId: uid,
        type: 'ORGANIZATION_BROADCAST' as const,
        title,
        body,
        data: {
          type: 'ORGANIZATION_BROADCAST',
          organizationId,
          ...(imageUrl ? { imageUrl } : {}),
        },
        actorUserId: actorUserId || null,
        entityType: 'ORGANIZATION',
        entityId: organizationId,
        sourceEventKey: key,
        push: true,
      }));
  }

  /** Notify a syndicate's ACTIVE members about a new request/inquiry (excludes the submitter). */
  private async syndicateOrgMembers(
    type: NotificationType,
    eventName: string,
    organizationId: string,
    submissionId: string,
    submitterUserId: string,
  ): Promise<NotificationSpec[]> {
    if (!organizationId || !submissionId) return [];
    const { items } = await this.deps.memberships.listForOrg(organizationId, {
      page: 1,
      pageSize: RECIPIENT_FANOUT_CAP,
      status: 'ACTIVE',
    });
    const key = `${eventName}:${submissionId}`;
    return items
      .filter((m) => m.userId !== submitterUserId)
      .map((m) =>
        this.spec(
          type,
          m.userId,
          { organizationId, submissionId },
          {
            actorUserId: submitterUserId || null,
            entityType: 'SYNDICATE_SUBMISSION',
            entityId: submissionId,
            sourceEventKey: key,
          },
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
        {
          entityId: opts.entityId,
          ...(str(p.conversationId) ? { conversationId: str(p.conversationId) } : {}),
        },
        {
          actorUserId: opts.actorUserId ?? null,
          entityType: opts.entityType,
          entityId: opts.entityId,
          sourceEventKey: `${eventName}:${opts.entityId}`,
        },
      ),
    ];
  }

  // --- review queues / owners / subscriptions -----------------------------

  /**
   * The people who act on a review queue: every ACTIVE global ADMIN plus the
   * ACTIVE system supervisors of `domain` (when the queue has one). Capped.
   */
  private async reviewerUserIds(domain: string | null): Promise<string[]> {
    const [admins, supervisors] = await Promise.all([
      this.deps.recipients.activeAdminUserIds(RECIPIENT_FANOUT_CAP),
      domain ? this.activeSupervisorUserIds(domain) : Promise.resolve([]),
    ]);
    return [...new Set([...admins, ...supervisors])].slice(0, RECIPIENT_FANOUT_CAP);
  }

  private async toReviewers(
    type: NotificationType,
    domain: string | null,
    opts: {
      excludeUserId: string;
      data: Record<string, string>;
      entityType: string;
      entityId: string;
      key: string;
    },
  ): Promise<NotificationSpec[]> {
    if (!opts.entityId) return [];
    const ids = await this.reviewerUserIds(domain);
    return ids
      .filter((id) => id !== opts.excludeUserId)
      .map((uid) =>
        this.spec(type, uid, opts.data, {
          actorUserId: opts.excludeUserId || null,
          entityType: opts.entityType,
          entityId: opts.entityId,
          sourceEventKey: opts.key,
        }),
      );
  }

  /** A self-registered organization awaiting approval → the reviewers. */
  private async organizationSubmitted(eventName: string, p: P): Promise<NotificationSpec[]> {
    const organizationId = str(p.organizationId);
    if (!organizationId) return [];
    const org = await this.deps.organizations.findById(organizationId);
    if (!org || org.status !== 'PENDING') return [];
    return this.toReviewers('ORGANIZATION_SUBMITTED', null, {
      excludeUserId: org.ownerUserId,
      data: { organizationId, organizationType: org.type },
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      key: `${eventName}:${organizationId}`,
    });
  }

  /** Subscription outcomes → the organization's owner (org type in `data` for routing). */
  private async subscriptionToOwner(
    type: NotificationType,
    p: P,
    key: string,
  ): Promise<NotificationSpec[]> {
    const organizationId = str(p.organizationId);
    if (!organizationId) return [];
    const org = await this.deps.organizations.findById(organizationId);
    if (!org) return [];
    return [
      this.spec(
        type,
        org.ownerUserId,
        {
          organizationId,
          organizationType: org.type,
          ...(str(p.requestId) ? { requestId: str(p.requestId) } : {}),
        },
        { entityType: 'ORGANIZATION', entityId: organizationId, sourceEventKey: key },
      ),
    ];
  }

  private async subscriptionRenewalRequested(eventName: string, p: P): Promise<NotificationSpec[]> {
    const organizationId = str(p.organizationId);
    const requestId = str(p.requestId);
    if (!organizationId || !requestId) return [];
    const org = await this.deps.organizations.findById(organizationId);
    if (!org) return [];
    return this.toReviewers('SUBSCRIPTION_RENEWAL_REQUESTED', null, {
      excludeUserId: org.ownerUserId,
      data: { organizationId, organizationType: org.type, requestId },
      entityType: 'SUBSCRIPTION_RENEWAL_REQUEST',
      entityId: requestId,
      key: `${eventName}:${requestId}`,
    });
  }

  /** Someone joined a farm with its join code → the farm owner. */
  private async farmMemberJoined(eventName: string, p: P): Promise<NotificationSpec[]> {
    const organizationId = str(p.organizationId);
    const joiner = str(p.userId);
    if (!organizationId) return [];
    const org = await this.deps.organizations.findById(organizationId);
    if (!org || org.ownerUserId === joiner) return [];
    return [
      this.spec(
        'FARM_MEMBER_JOINED',
        org.ownerUserId,
        { organizationId, organizationType: org.type },
        {
          actorUserId: joiner || null,
          entityType: 'ORGANIZATION',
          entityId: organizationId,
          sourceEventKey: `${eventName}:${str(p.membershipId)}`,
        },
      ),
    ];
  }

  /** New farm appointment → the farm's owner + ACTIVE members, minus the creator. */
  private async farmAppointmentCreated(eventName: string, p: P): Promise<NotificationSpec[]> {
    const organizationId = str(p.organizationId);
    const appointmentId = str(p.appointmentId);
    const creator = str(p.createdByUserId);
    if (!organizationId || !appointmentId) return [];
    const [org, { items }] = await Promise.all([
      this.deps.organizations.findById(organizationId),
      this.deps.memberships.listForOrg(organizationId, {
        page: 1,
        pageSize: RECIPIENT_FANOUT_CAP,
        status: 'ACTIVE',
      }),
    ]);
    const recipients = new Set(items.map((m) => m.userId));
    if (org) recipients.add(org.ownerUserId);
    recipients.delete(creator);
    return [...recipients].map((uid) =>
      this.spec(
        'FARM_APPOINTMENT_CREATED',
        uid,
        { organizationId, appointmentId },
        {
          actorUserId: creator || null,
          entityType: 'FARM_APPOINTMENT',
          entityId: appointmentId,
          sourceEventKey: `${eventName}:${appointmentId}`,
        },
      ),
    );
  }

  private userStatusChanged(event: DomainEvent, p: P): NotificationSpec[] {
    const userId = str(p.userId);
    const status = str(p.status);
    // `from` is absent on events published before the payload carried it —
    // treat that as "unknown transition" and stay quiet rather than guess.
    if (!userId || !status || !str(p.from) || str(p.from) === status) return [];
    // Completing email verification is not notified: the user is on the verify
    // screen at that moment (and has no push device registered yet).
    if (p.reason === 'email_verified') return [];
    return this.toUser('ACCOUNT_STATUS_CHANGED', userId, {
      status,
      key: repeatableKey(event, userId),
    });
  }

  /**
   * "تسجيل" in a course/seminar: confirmation → the registrant; heads-up →
   * the organizer; and — exactly once, on the registration that fills the last
   * seat — "capacity reached" → the organizer.
   */
  private vetCourseRegistration(eventName: string, p: P): NotificationSpec[] {
    const courseId = str(p.courseId);
    const creator = str(p.creatorUserId);
    const registrant = str(p.registrantUserId);
    if (!courseId) return [];
    const data = {
      entityId: courseId,
      ...(str(p.courseType) ? { courseType: str(p.courseType) } : {}),
    };
    const out = this.vetServiceToUser('VET_COURSE_REGISTRATION_CONFIRMED', eventName, p, {
      userId: registrant,
      entityType: 'VET_COURSE',
      entityId: courseId,
    });
    if (creator && creator !== registrant) {
      out.push(
        this.spec('VET_COURSE_REGISTRATION_RECEIVED', creator, data, {
          actorUserId: registrant || null,
          entityType: 'VET_COURSE',
          entityId: courseId,
          sourceEventKey: `${eventName}:${str(p.registrationId)}`,
        }),
      );
      const capacity = typeof p.capacity === 'number' ? p.capacity : null;
      const count = typeof p.registrationCount === 'number' ? p.registrationCount : 0;
      if (capacity !== null && count >= capacity) {
        out.push(
          this.spec('VET_COURSE_CAPACITY_REACHED', creator, data, {
            entityType: 'VET_COURSE',
            entityId: courseId,
            sourceEventKey: `vet_course.capacity_reached:${courseId}`,
          }),
        );
      }
    }
    return out;
  }

  /** A course/seminar was cancelled → every registrant (minus whoever cancelled it). */
  private async vetCourseCancelled(eventName: string, p: P): Promise<NotificationSpec[]> {
    const courseId = str(p.courseId);
    const actor = str(p.actorUserId);
    if (!courseId) return [];
    const ids = await this.deps.recipients.courseRegistrantUserIds(courseId, RECIPIENT_FANOUT_CAP);
    return ids
      .filter((id) => id !== actor)
      .map((uid) =>
        this.spec(
          'VET_COURSE_CANCELLED',
          uid,
          { entityId: courseId, ...(str(p.courseType) ? { courseType: str(p.courseType) } : {}) },
          {
            actorUserId: actor || null,
            entityType: 'VET_COURSE',
            entityId: courseId,
            sourceEventKey: `${eventName}:${courseId}`,
          },
        ),
      );
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

/**
 * Idempotency key for a transition that can legitimately happen more than
 * once for the same entity (suspend → reactivate → suspend, resubmit after
 * rejection…). `occurredAt` is fixed on the event object, so a redelivery of
 * the SAME event still dedupes while a later, genuine repeat does not.
 */
function repeatableKey(event: DomainEvent, id: string): string {
  return `${event.name}:${id}:${event.occurredAt.getTime()}`;
}

const TRADER_TYPES: Record<string, NotificationType> = {
  'trader.approved': 'TRADER_APPROVED',
  'trader.rejected': 'TRADER_REJECTED',
  'trader.suspended': 'TRADER_SUSPENDED',
  'trader.reactivated': 'TRADER_REACTIVATED',
};
