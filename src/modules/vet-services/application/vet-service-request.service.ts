import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import {
  VetServiceAuditAction,
  VetServiceAuditEntity,
  VetServiceEvent,
  VET_SERVICE_MAX_REQUEST_IMAGES,
  VET_SERVICE_SUPERVISOR_DOMAIN,
} from '../domain/vet-service.constants.js';
import { VetServicePolicy } from '../domain/vet-service.policy.js';
import type {
  CreateVetServiceRequestInput,
  MineFilter,
  ModerationFilter,
  PublicVetServiceRequestDTO,
  RequestBrowseFilter,
  VetServiceRequest,
  VetServiceRequestDTO,
} from '../domain/vet-service.types.js';
import {
  nextRequestNumber,
  type VetServiceRequestRepository,
  type VetServiceRequestWithOwner,
} from '../infrastructure/vet-service-request.repository.js';
import type { VetServiceActor } from './vet-service-listing.service.js';
import type { VetServiceMedia } from './vet-service-media.js';

/**
 * Pet-owner standalone service REQUESTS ("طلبات أصحاب الحيوانات"). Any
 * authenticated user may publish one; it starts PENDING and is not public until
 * an ADMIN or a VET_SERVICE supervisor approves it. Veterinarians then submit
 * OFFERS (see {@link VetServiceOfferService}).
 */
export class VetServiceRequestService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly requests: VetServiceRequestRepository,
    private readonly media: VetServiceMedia,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-service-request-service' });
  }

  private async toDTO(data: VetServiceRequestWithOwner): Promise<VetServiceRequestDTO> {
    const { imageKeys, ...rest } = data.request;
    return {
      ...rest,
      petOwner: data.petOwner,
      offerCount: data.offerCount,
      imageUrls: await this.media.resolveUrls(imageKeys),
    };
  }

  private async toPublicDTO(data: VetServiceRequestWithOwner): Promise<PublicVetServiceRequestDTO> {
    const r = data.request;
    return {
      id: r.id,
      requestNumber: r.requestNumber,
      title: r.title,
      description: r.description,
      animalType: r.animalType,
      serviceType: r.serviceType,
      animalCount: r.animalCount,
      animalAge: r.animalAge,
      governorate: r.governorate,
      district: r.district,
      needsFieldVisit: r.needsFieldVisit,
      preferredDate: r.preferredDate,
      budgetAmount: r.budgetAmount,
      urgency: r.urgency,
      extraNotes: r.extraNotes,
      imageUrls: await this.media.resolveUrls(r.imageKeys),
      petOwner: data.petOwner,
      publishedAt: r.reviewedAt ?? r.createdAt,
    };
  }

  // --- create (any authenticated user) --------------------------

  async create(
    input: CreateVetServiceRequestInput,
    actor: VetServiceActor,
  ): Promise<VetServiceRequestDTO> {
    const imageKeys = await this.media.validateKeys(
      input.imageKeys ?? [],
      VET_SERVICE_MAX_REQUEST_IMAGES,
    );

    const request = await this.db.transaction(async (tx) => {
      const requestNumber = await nextRequestNumber(tx);
      const created = await this.requests.create(
        { ...input, imageKeys, petOwnerUserId: actor.principal.userId, requestNumber },
        tx,
      );
      await this.audit.record(
        {
          action: VetServiceAuditAction.REQUEST_CREATED,
          entityType: VetServiceAuditEntity.REQUEST,
          entityId: created.id,
          actorUserId: actor.principal.userId,
          metadata: { requestNumber: created.requestNumber, urgency: created.urgency },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish(VetServiceEvent.REQUEST_SUBMITTED, {
      requestId: request.id,
      petOwnerUserId: request.petOwnerUserId,
    });
    return this.mustGetDTO(request.id);
  }

  // --- reads --------------------------------------------------

  async listPublic(
    filter: RequestBrowseFilter,
  ): Promise<{ items: PublicVetServiceRequestDTO[]; total: number }> {
    const { items, total } = await this.requests.listPublic(filter);
    return { items: await Promise.all(items.map((i) => this.toPublicDTO(i))), total };
  }

  async getPublic(id: string): Promise<PublicVetServiceRequestDTO> {
    const data = await this.requests.findWithOwnerById(id);
    if (!data || data.request.status !== 'APPROVED') {
      throw new NotFoundError('Service request not found');
    }
    return this.toPublicDTO(data);
  }

  async listMine(
    petOwnerUserId: string,
    filter: MineFilter,
  ): Promise<{ items: VetServiceRequestDTO[]; total: number }> {
    const { items, total } = await this.requests.listMine(petOwnerUserId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForActor(id: string, actor: VetServiceActor): Promise<VetServiceRequestDTO> {
    const data = await this.requests.findWithOwnerById(id);
    if (!data) throw new NotFoundError('Service request not found');
    const isOwner = data.request.petOwnerUserId === actor.principal.userId;
    const isModerator = await this.authz.isSystemSupervisorFor(
      actor.principal,
      VET_SERVICE_SUPERVISOR_DOMAIN,
    );
    // A vet browsing an APPROVED request also gets the full detail view.
    const isVisibleVet =
      data.request.status === 'APPROVED' &&
      data.request.closedAt === null &&
      this.authz.isApprovedVeterinarian(actor.principal);
    if (!isOwner && !isModerator && !isVisibleVet) {
      throw new NotFoundError('Service request not found');
    }
    return this.toDTO(data);
  }

  // --- owner actions ---------------------------------------

  async remove(id: string, actor: VetServiceActor): Promise<void> {
    const existing = await this.requests.findById(id);
    if (!existing) throw new NotFoundError('Service request not found');
    await this.assertOwnerOrModerator(existing, actor);
    await this.db.transaction(async (tx) => {
      await this.requests.deleteById(id, tx);
      await this.audit.record(
        {
          action: VetServiceAuditAction.REQUEST_DELETED,
          entityType: VetServiceAuditEntity.REQUEST,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { status: existing.status },
          context: actor.context,
        },
        tx,
      );
    });
  }

  async close(id: string, actor: VetServiceActor): Promise<VetServiceRequestDTO> {
    const existing = await this.requests.findById(id);
    if (!existing) throw new NotFoundError('Service request not found');
    VetServicePolicy.assertOwner(
      { ownerUserId: existing.petOwnerUserId },
      actor.principal.userId,
      'request',
    );
    await this.db.transaction((tx) =>
      this.requests.update(id, { closedAt: new Date() }, tx).then(() =>
        this.audit.record(
          {
            action: VetServiceAuditAction.REQUEST_CLOSED,
            entityType: VetServiceAuditEntity.REQUEST,
            entityId: id,
            actorUserId: actor.principal.userId,
            context: actor.context,
          },
          tx,
        ),
      ),
    );
    return this.mustGetDTO(id);
  }

  // --- moderation ----------------------------------------

  async listForModeration(
    filter: ModerationFilter,
  ): Promise<{ items: VetServiceRequestDTO[]; total: number }> {
    const { items, total } = await this.requests.listForModeration(filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForModeration(id: string): Promise<VetServiceRequestDTO> {
    const data = await this.requests.findWithOwnerById(id);
    if (!data) throw new NotFoundError('Service request not found');
    return this.toDTO(data);
  }

  approve(id: string, actor: VetServiceActor): Promise<VetServiceRequestDTO> {
    return this.review(id, 'APPROVED', null, actor);
  }

  reject(id: string, reason: string, actor: VetServiceActor): Promise<VetServiceRequestDTO> {
    return this.review(id, 'REJECTED', reason, actor);
  }

  private async review(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    reason: string | null,
    actor: VetServiceActor,
  ): Promise<VetServiceRequestDTO> {
    const existing = await this.requests.findById(id);
    if (!existing) throw new NotFoundError('Service request not found');
    VetServicePolicy.assertModerationPending(existing);

    await this.db.transaction(async (tx) => {
      await this.requests.update(
        id,
        {
          status,
          reviewedByUserId: actor.principal.userId,
          reviewedAt: new Date(),
          rejectionReason: reason,
        },
        tx,
      );
      await this.audit.record(
        {
          action:
            status === 'APPROVED'
              ? VetServiceAuditAction.REQUEST_APPROVED
              : VetServiceAuditAction.REQUEST_REJECTED,
          entityType: VetServiceAuditEntity.REQUEST,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: status === 'REJECTED' ? { reason } : {},
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish(
      status === 'APPROVED' ? VetServiceEvent.REQUEST_APPROVED : VetServiceEvent.REQUEST_REJECTED,
      {
        requestId: id,
        petOwnerUserId: existing.petOwnerUserId,
        actorUserId: actor.principal.userId,
        ...(status === 'REJECTED' ? { reason } : {}),
      },
    );
    return this.mustGetDTO(id);
  }

  // --- helpers -----------------------------------------

  /** Internal — the offer service uses this to gate submissions. */
  async loadEngageContext(
    id: string,
  ): Promise<{ id: string; petOwnerUserId: string; status: string; closedAt: string | null } | null> {
    const r = await this.requests.findById(id);
    return r
      ? { id: r.id, petOwnerUserId: r.petOwnerUserId, status: r.status, closedAt: r.closedAt }
      : null;
  }

  private async assertOwnerOrModerator(
    request: VetServiceRequest,
    actor: VetServiceActor,
  ): Promise<void> {
    if (request.petOwnerUserId === actor.principal.userId) return;
    if (await this.authz.isSystemSupervisorFor(actor.principal, VET_SERVICE_SUPERVISOR_DOMAIN)) {
      return;
    }
    throw new ForbiddenError('Only the request owner or a moderator can do this', {
      code: ErrorCode.PERMISSION_DENIED,
    });
  }

  private async mustGetDTO(id: string): Promise<VetServiceRequestDTO> {
    const data = await this.requests.findWithOwnerById(id);
    if (!data) throw new NotFoundError('Service request not found');
    return this.toDTO(data);
  }
}
