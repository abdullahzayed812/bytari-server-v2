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
  CreateVetServiceOfferInput,
  EngagementListFilter,
  VetServiceOfferDTO,
} from '../domain/vet-service.types.js';
import type {
  VetServiceOfferJoined,
  VetServiceOfferRepository,
} from '../infrastructure/vet-service-offer.repository.js';
import type { VetServiceActor } from './vet-service-listing.service.js';
import type { VetServiceMedia } from './vet-service-media.js';
import type { VetServiceRequestService } from './vet-service-request.service.js';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * OFFERS a Veterinarian submits on a pet-owner service REQUEST ("تقديم عرض").
 * PENDING until the request owner accepts / rejects. On accept a
 * PET_OWNER_VETERINARIAN conversation is created / pinned and every other
 * PENDING offer on that request is auto-rejected. "إنهاء الطلب" completes it.
 */
export class VetServiceOfferService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly offers: VetServiceOfferRepository,
    private readonly requests: VetServiceRequestService,
    private readonly media: VetServiceMedia,
    private readonly authz: AuthorizationService,
    private readonly chat: ChatService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-service-offer-service' });
  }

  private async toDTO(data: VetServiceOfferJoined): Promise<VetServiceOfferDTO> {
    const { imageKeys, ...rest } = data.offer;
    return {
      ...rest,
      veterinarian: data.veterinarian,
      request: data.request,
      imageUrls: await this.media.resolveUrls(imageKeys),
    };
  }

  // --- create (approved vet, not own request) -----------------

  async create(
    requestId: string,
    input: CreateVetServiceOfferInput,
    actor: VetServiceActor,
  ): Promise<VetServiceOfferDTO> {
    this.authz.assertApprovedVeterinarian(actor.principal);

    const req = await this.requests.loadEngageContext(requestId);
    if (!req) throw new NotFoundError('Service request not found');
    VetServicePolicy.assertPubliclyEngageable(req, 'request');
    VetServicePolicy.assertNotSelf(
      req.petOwnerUserId,
      actor.principal.userId,
      'You cannot submit an offer on your own request',
    );

    const imageKeys = await this.media.validateKeys(
      input.imageKeys ?? [],
      VET_SERVICE_MAX_OFFER_IMAGES,
    );

    let offerId: string;
    try {
      offerId = await this.db.transaction(async (tx) => {
        const created = await this.offers.create(
          { ...input, imageKeys, requestId, veterinarianUserId: actor.principal.userId },
          tx,
        );
        await this.audit.record(
          {
            action: VetServiceAuditAction.OFFER_SUBMITTED,
            entityType: VetServiceAuditEntity.OFFER,
            entityId: created.id,
            actorUserId: actor.principal.userId,
            metadata: { requestId },
            context: actor.context,
          },
          tx,
        );
        return created.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('You already have an open offer on this request', {
          code: ErrorCode.VET_SERVICE_ENGAGEMENT_NOT_PENDING,
        });
      }
      throw err;
    }

    this.events.publish(VetServiceEvent.OFFER_RECEIVED, {
      offerId,
      requestId,
      petOwnerUserId: req.petOwnerUserId,
      veterinarianUserId: actor.principal.userId,
    });
    return this.mustGetDTO(offerId);
  }

  /**
   * "تواصل مع صاحب الطلب" — a Veterinarian opens a direct chat with a request
   * owner BEFORE any offer is accepted. Idempotent (one conversation per pair).
   */
  async startConversation(
    requestId: string,
    actor: VetServiceActor,
  ): Promise<{ conversationId: string }> {
    this.authz.assertApprovedVeterinarian(actor.principal);
    const req = await this.requests.loadEngageContext(requestId);
    if (!req) throw new NotFoundError('Service request not found');
    VetServicePolicy.assertPubliclyEngageable(req, 'request');
    VetServicePolicy.assertNotSelf(
      req.petOwnerUserId,
      actor.principal.userId,
      'You cannot chat with yourself',
    );
    const { conversation } = await this.chat.getOrCreateDeal(
      { actorUserId: actor.principal.userId, context: actor.context },
      { petOwnerUserId: req.petOwnerUserId, veterinarianUserId: actor.principal.userId },
    );
    return { conversationId: conversation.id };
  }

  // --- reads -------------------------------------------------

  /** Offers on a request — the request owner (or a moderator) only. */
  async listForRequest(
    requestId: string,
    filter: EngagementListFilter,
    actor: VetServiceActor,
  ): Promise<{ items: VetServiceOfferDTO[]; total: number }> {
    const req = await this.requests.loadEngageContext(requestId);
    if (!req) throw new NotFoundError('Service request not found');
    if (req.petOwnerUserId !== actor.principal.userId) {
      throw new NotFoundError('Service request not found');
    }
    const { items, total } = await this.offers.listForRequest(requestId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  /** The caller's own submitted offers ("العروض المقدمة"). */
  async listMine(
    veterinarianUserId: string,
    filter: EngagementListFilter,
  ): Promise<{ items: VetServiceOfferDTO[]; total: number }> {
    const { items, total } = await this.offers.listMine(veterinarianUserId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForActor(id: string, actor: VetServiceActor): Promise<VetServiceOfferDTO> {
    const data = await this.offers.findJoinedById(id);
    if (!data) throw new NotFoundError('Offer not found');
    const uid = actor.principal.userId;
    if (data.offer.veterinarianUserId !== uid && data.request.petOwnerUserId !== uid) {
      throw new NotFoundError('Offer not found');
    }
    return this.toDTO(data);
  }

  // --- responses ------------------------------------------

  /** The request owner accepts → a conversation is created + pinned, others rejected. */
  async accept(id: string, actor: VetServiceActor): Promise<VetServiceOfferDTO> {
    const data = await this.offers.findJoinedById(id);
    if (!data) throw new NotFoundError('Offer not found');
    if (data.request.petOwnerUserId !== actor.principal.userId) {
      throw new NotFoundError('Offer not found');
    }
    VetServicePolicy.assertEngagementPending(data.offer);

    const { conversation } = await this.chat.getOrCreateDeal(
      { actorUserId: actor.principal.userId, context: actor.context },
      {
        petOwnerUserId: data.request.petOwnerUserId,
        veterinarianUserId: data.offer.veterinarianUserId,
        subjectType: 'VET_SERVICE_OFFER',
        subjectId: id,
      },
    );

    await this.db.transaction(async (tx) => {
      await this.offers.update(
        id,
        { status: 'ACCEPTED', conversationId: conversation.id, decidedAt: new Date() },
        tx,
      );
      await this.offers.rejectOthers(data.offer.requestId, id, tx);
      await this.audit.record(
        {
          action: VetServiceAuditAction.OFFER_ACCEPTED,
          entityType: VetServiceAuditEntity.OFFER,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { requestId: data.offer.requestId, conversationId: conversation.id },
          context: actor.context,
        },
        tx,
      );
    });
    await this.chat.pinDealSubject(conversation.id, 'VET_SERVICE_OFFER', id);

    this.events.publish(VetServiceEvent.OFFER_ACCEPTED, {
      offerId: id,
      requestId: data.offer.requestId,
      petOwnerUserId: data.request.petOwnerUserId,
      veterinarianUserId: data.offer.veterinarianUserId,
      conversationId: conversation.id,
    });
    return this.mustGetDTO(id);
  }

  async reject(id: string, actor: VetServiceActor): Promise<VetServiceOfferDTO> {
    const data = await this.offers.findJoinedById(id);
    if (!data) throw new NotFoundError('Offer not found');
    if (data.request.petOwnerUserId !== actor.principal.userId) {
      throw new NotFoundError('Offer not found');
    }
    VetServicePolicy.assertEngagementPending(data.offer);
    await this.transition(id, 'REJECTED', VetServiceAuditAction.OFFER_REJECTED, actor);
    this.events.publish(VetServiceEvent.OFFER_REJECTED, {
      offerId: id,
      requestId: data.offer.requestId,
      petOwnerUserId: data.request.petOwnerUserId,
      veterinarianUserId: data.offer.veterinarianUserId,
    });
    return this.mustGetDTO(id);
  }

  /** The submitting vet withdraws their own PENDING offer. */
  async withdraw(id: string, actor: VetServiceActor): Promise<VetServiceOfferDTO> {
    const existing = await this.offers.findById(id);
    if (!existing || existing.veterinarianUserId !== actor.principal.userId) {
      throw new NotFoundError('Offer not found');
    }
    VetServicePolicy.assertEngagementPending(existing);
    await this.transition(id, 'CANCELLED', VetServiceAuditAction.OFFER_WITHDRAWN, actor);
    return this.mustGetDTO(id);
  }

  /** "إنهاء الطلب" — either party completes an ACCEPTED offer. */
  async complete(id: string, actor: VetServiceActor): Promise<VetServiceOfferDTO> {
    const data = await this.offers.findJoinedById(id);
    if (!data) throw new NotFoundError('Offer not found');
    const uid = actor.principal.userId;
    if (data.offer.veterinarianUserId !== uid && data.request.petOwnerUserId !== uid) {
      throw new NotFoundError('Offer not found');
    }
    VetServicePolicy.assertEngagementAccepted(data.offer);

    await this.transition(id, 'COMPLETED', VetServiceAuditAction.OFFER_COMPLETED, actor);
    if (data.offer.conversationId) {
      await this.chat.setDealStatus(
        { actorUserId: uid, context: actor.context },
        data.offer.conversationId,
        'COMPLETED',
      );
    }
    this.events.publish(VetServiceEvent.DEAL_COMPLETED, {
      subjectType: 'VET_SERVICE_OFFER',
      subjectId: id,
      petOwnerUserId: data.request.petOwnerUserId,
      veterinarianUserId: data.offer.veterinarianUserId,
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
      await this.offers.update(id, { status, decidedAt: new Date() }, tx);
      await this.audit.record(
        {
          action,
          entityType: VetServiceAuditEntity.OFFER,
          entityId: id,
          actorUserId: actor.principal.userId,
          context: actor.context,
        },
        tx,
      );
    });
  }

  private async mustGetDTO(id: string): Promise<VetServiceOfferDTO> {
    const data = await this.offers.findJoinedById(id);
    if (!data) throw new NotFoundError('Offer not found');
    return this.toDTO(data);
  }
}
