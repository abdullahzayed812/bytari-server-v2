import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { ChatService } from '../../chat/application/chat.service.js';
import {
  VetServiceAuditAction,
  VetServiceAuditEntity,
  VetServiceEvent,
  VET_SERVICE_MAX_OFFER_IMAGES,
} from '../domain/vet-service.constants.js';
import { VetServicePolicy } from '../domain/vet-service.policy.js';
import type {
  CreateVetServiceListingRequestInput,
  EngagementListFilter,
  VetServiceListingRequestDTO,
} from '../domain/vet-service.types.js';
import { nextRequestNumber } from '../infrastructure/vet-service-request.repository.js';
import type {
  VetServiceListingRequestJoined,
  VetServiceListingRequestRepository,
} from '../infrastructure/vet-service-listing-request.repository.js';
import type { VetServiceActor, VetServiceListingService } from './vet-service-listing.service.js';
import type { VetServiceMedia } from './vet-service-media.js';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * A Pet Owner requests a specific Veterinarian LISTING ("طلب العرض"). PENDING
 * until the listing's vet accepts / rejects ("الموافقة على الخدمة" tab). On
 * accept a PET_OWNER_VETERINARIAN conversation is created + pinned; "إنهاء
 * الطلب" completes it.
 */
export class VetServiceListingRequestService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly listingRequests: VetServiceListingRequestRepository,
    private readonly listings: VetServiceListingService,
    private readonly media: VetServiceMedia,
    private readonly authz: AuthorizationService,
    private readonly chat: ChatService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-service-listing-request-service' });
  }

  private async toDTO(
    data: VetServiceListingRequestJoined,
  ): Promise<VetServiceListingRequestDTO> {
    const { imageKeys, ...rest } = data.listingRequest;
    return {
      ...rest,
      petOwner: data.petOwner,
      listing: data.listing,
      imageUrls: await this.media.resolveUrls(imageKeys),
    };
  }

  // --- create (any authenticated user, not own listing) -----

  async create(
    listingId: string,
    input: CreateVetServiceListingRequestInput,
    actor: VetServiceActor,
  ): Promise<VetServiceListingRequestDTO> {
    const listing = await this.listings.loadEngageContext(listingId);
    if (!listing) throw new NotFoundError('Service listing not found');
    VetServicePolicy.assertPubliclyEngageable(listing, 'listing');
    VetServicePolicy.assertNotSelf(
      listing.veterinarianUserId,
      actor.principal.userId,
      'You cannot request your own listing',
    );

    const imageKeys = await this.media.validateKeys(
      input.imageKeys ?? [],
      VET_SERVICE_MAX_OFFER_IMAGES,
    );

    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const requestNumber = await nextRequestNumber(tx);
        const created = await this.listingRequests.create(
          { ...input, imageKeys, listingId, petOwnerUserId: actor.principal.userId, requestNumber },
          tx,
        );
        await this.audit.record(
          {
            action: VetServiceAuditAction.LISTING_REQUEST_SUBMITTED,
            entityType: VetServiceAuditEntity.LISTING_REQUEST,
            entityId: created.id,
            actorUserId: actor.principal.userId,
            metadata: { listingId, requestNumber: created.requestNumber },
            context: actor.context,
          },
          tx,
        );
        return created.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('You already have an open request on this listing', {
          code: ErrorCode.VET_SERVICE_ENGAGEMENT_NOT_PENDING,
        });
      }
      throw err;
    }

    this.events.publish(VetServiceEvent.LISTING_REQUEST_RECEIVED, {
      listingRequestId: id,
      listingId,
      veterinarianUserId: listing.veterinarianUserId,
      petOwnerUserId: actor.principal.userId,
    });
    return this.mustGetDTO(id);
  }

  /**
   * "تواصل مع الطبيب" — a Pet Owner opens a direct chat with a listing's vet
   * BEFORE any request is accepted. Idempotent.
   */
  async startConversation(
    listingId: string,
    actor: VetServiceActor,
  ): Promise<{ conversationId: string }> {
    const listing = await this.listings.loadEngageContext(listingId);
    if (!listing) throw new NotFoundError('Service listing not found');
    VetServicePolicy.assertPubliclyEngageable(listing, 'listing');
    VetServicePolicy.assertNotSelf(
      listing.veterinarianUserId,
      actor.principal.userId,
      'You cannot chat with yourself',
    );
    const { conversation } = await this.chat.getOrCreateDeal(
      { actorUserId: actor.principal.userId, context: actor.context },
      { petOwnerUserId: actor.principal.userId, veterinarianUserId: listing.veterinarianUserId },
    );
    return { conversationId: conversation.id };
  }

  // --- reads -----------------------------------------------

  /** Requests received across ALL of the caller's listings ("الموافقة على الخدمة"). */
  async listForVet(
    veterinarianUserId: string,
    filter: EngagementListFilter,
  ): Promise<{ items: VetServiceListingRequestDTO[]; total: number }> {
    const { items, total } = await this.listingRequests.listForVet(veterinarianUserId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  /** Requests on ONE listing — the listing's vet only. */
  async listForListing(
    listingId: string,
    filter: EngagementListFilter,
    actor: VetServiceActor,
  ): Promise<{ items: VetServiceListingRequestDTO[]; total: number }> {
    const listing = await this.listings.loadEngageContext(listingId);
    if (!listing || listing.veterinarianUserId !== actor.principal.userId) {
      throw new NotFoundError('Service listing not found');
    }
    const { items, total } = await this.listingRequests.listForListing(listingId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  /** The caller's own listing-requests ("طلباتي"). */
  async listMine(
    petOwnerUserId: string,
    filter: EngagementListFilter,
  ): Promise<{ items: VetServiceListingRequestDTO[]; total: number }> {
    const { items, total } = await this.listingRequests.listMine(petOwnerUserId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForActor(id: string, actor: VetServiceActor): Promise<VetServiceListingRequestDTO> {
    const data = await this.listingRequests.findJoinedById(id);
    if (!data) throw new NotFoundError('Request not found');
    const uid = actor.principal.userId;
    if (data.listingRequest.petOwnerUserId !== uid && data.listing.veterinarianUserId !== uid) {
      throw new NotFoundError('Request not found');
    }
    return this.toDTO(data);
  }

  // --- responses ----------------------------------------

  /** The listing's vet accepts → conversation created + pinned. */
  async accept(id: string, actor: VetServiceActor): Promise<VetServiceListingRequestDTO> {
    const data = await this.listingRequests.findJoinedById(id);
    if (!data) throw new NotFoundError('Request not found');
    if (data.listing.veterinarianUserId !== actor.principal.userId) {
      throw new NotFoundError('Request not found');
    }
    VetServicePolicy.assertEngagementPending(data.listingRequest);

    const { conversation } = await this.chat.getOrCreateDeal(
      { actorUserId: actor.principal.userId, context: actor.context },
      {
        petOwnerUserId: data.listingRequest.petOwnerUserId,
        veterinarianUserId: data.listing.veterinarianUserId,
        subjectType: 'VET_SERVICE_LISTING_REQUEST',
        subjectId: id,
      },
    );

    await this.db.transaction(async (tx) => {
      await this.listingRequests.update(
        id,
        { status: 'ACCEPTED', conversationId: conversation.id, decidedAt: new Date() },
        tx,
      );
      await this.audit.record(
        {
          action: VetServiceAuditAction.LISTING_REQUEST_ACCEPTED,
          entityType: VetServiceAuditEntity.LISTING_REQUEST,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { conversationId: conversation.id },
          context: actor.context,
        },
        tx,
      );
    });
    await this.chat.pinDealSubject(conversation.id, 'VET_SERVICE_LISTING_REQUEST', id);

    this.events.publish(VetServiceEvent.LISTING_REQUEST_ACCEPTED, {
      listingRequestId: id,
      listingId: data.listingRequest.listingId,
      petOwnerUserId: data.listingRequest.petOwnerUserId,
      veterinarianUserId: data.listing.veterinarianUserId,
      conversationId: conversation.id,
    });
    return this.mustGetDTO(id);
  }

  async reject(id: string, actor: VetServiceActor): Promise<VetServiceListingRequestDTO> {
    const data = await this.listingRequests.findJoinedById(id);
    if (!data) throw new NotFoundError('Request not found');
    if (data.listing.veterinarianUserId !== actor.principal.userId) {
      throw new NotFoundError('Request not found');
    }
    VetServicePolicy.assertEngagementPending(data.listingRequest);
    await this.transition(id, 'REJECTED', VetServiceAuditAction.LISTING_REQUEST_REJECTED, actor);
    this.events.publish(VetServiceEvent.LISTING_REQUEST_REJECTED, {
      listingRequestId: id,
      petOwnerUserId: data.listingRequest.petOwnerUserId,
      veterinarianUserId: data.listing.veterinarianUserId,
    });
    return this.mustGetDTO(id);
  }

  /** The Pet Owner cancels their own PENDING request. */
  async cancel(id: string, actor: VetServiceActor): Promise<VetServiceListingRequestDTO> {
    const existing = await this.listingRequests.findById(id);
    if (!existing || existing.petOwnerUserId !== actor.principal.userId) {
      throw new NotFoundError('Request not found');
    }
    VetServicePolicy.assertEngagementPending(existing);
    await this.transition(id, 'CANCELLED', VetServiceAuditAction.LISTING_REQUEST_CANCELLED, actor);
    return this.mustGetDTO(id);
  }

  /** "إنهاء الطلب" — either party completes an ACCEPTED request. */
  async complete(id: string, actor: VetServiceActor): Promise<VetServiceListingRequestDTO> {
    const data = await this.listingRequests.findJoinedById(id);
    if (!data) throw new NotFoundError('Request not found');
    const uid = actor.principal.userId;
    if (data.listingRequest.petOwnerUserId !== uid && data.listing.veterinarianUserId !== uid) {
      throw new NotFoundError('Request not found');
    }
    VetServicePolicy.assertEngagementAccepted(data.listingRequest);
    await this.transition(id, 'COMPLETED', VetServiceAuditAction.LISTING_REQUEST_COMPLETED, actor);
    if (data.listingRequest.conversationId) {
      await this.chat.setDealStatus(
        { actorUserId: uid, context: actor.context },
        data.listingRequest.conversationId,
        'COMPLETED',
      );
    }
    this.events.publish(VetServiceEvent.DEAL_COMPLETED, {
      subjectType: 'VET_SERVICE_LISTING_REQUEST',
      subjectId: id,
      petOwnerUserId: data.listingRequest.petOwnerUserId,
      veterinarianUserId: data.listing.veterinarianUserId,
      actorUserId: uid,
    });
    return this.mustGetDTO(id);
  }

  private async transition(
    id: string,
    status: 'REJECTED' | 'CANCELLED' | 'COMPLETED',
    action: string,
    actor: VetServiceActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.listingRequests.update(id, { status, decidedAt: new Date() }, tx);
      await this.audit.record(
        {
          action,
          entityType: VetServiceAuditEntity.LISTING_REQUEST,
          entityId: id,
          actorUserId: actor.principal.userId,
          context: actor.context,
        },
        tx,
      );
    });
  }

  private async mustGetDTO(id: string): Promise<VetServiceListingRequestDTO> {
    const data = await this.listingRequests.findJoinedById(id);
    if (!data) throw new NotFoundError('Request not found');
    return this.toDTO(data);
  }
}
