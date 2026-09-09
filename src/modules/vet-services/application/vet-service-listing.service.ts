import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import {
  VetServiceAuditAction,
  VetServiceAuditEntity,
  VetServiceEvent,
  VET_SERVICE_MAX_IMAGES,
  VET_SERVICE_SUPERVISOR_DOMAIN,
} from '../domain/vet-service.constants.js';
import { VetServicePolicy } from '../domain/vet-service.policy.js';
import type {
  CreateVetServiceListingInput,
  ListingBrowseFilter,
  MineFilter,
  ModerationFilter,
  PublicVetServiceListingDTO,
  VetServiceListing,
  VetServiceListingDTO,
} from '../domain/vet-service.types.js';
import type {
  VetServiceListingRepository,
  VetServiceListingWithVet,
} from '../infrastructure/vet-service-listing.repository.js';
import type { VetServiceMedia } from './vet-service-media.js';

export interface VetServiceActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

/**
 * Veterinarian service LISTINGS. A Veterinarian publishes a service; it starts
 * PENDING and is NOT public until an ADMIN or a VET_SERVICE system-supervisor
 * approves it — the exact reusable lifecycle from animal publications.
 */
export class VetServiceListingService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly listings: VetServiceListingRepository,
    private readonly media: VetServiceMedia,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-service-listing-service' });
  }

  // --- DTO assembly -----------------------------------------------

  private async toDTO(data: VetServiceListingWithVet): Promise<VetServiceListingDTO> {
    const { imageKeys, ...rest } = data.listing;
    return {
      ...rest,
      veterinarian: data.veterinarian,
      imageUrls: await this.media.resolveUrls(imageKeys),
    };
  }

  private async toPublicDTO(
    data: VetServiceListingWithVet,
  ): Promise<PublicVetServiceListingDTO> {
    const l = data.listing;
    return {
      id: l.id,
      title: l.title,
      description: l.description,
      serviceType: l.serviceType,
      animalType: l.animalType,
      specialty: l.specialty,
      governorate: l.governorate,
      district: l.district,
      priceAmount: l.priceAmount,
      priceType: l.priceType,
      locationMode: l.locationMode,
      availability: l.availability,
      contactPhone: l.contactPhone,
      contactWhatsapp: l.contactWhatsapp,
      executionDuration: l.executionDuration,
      arrivalTime: l.arrivalTime,
      details: l.details,
      imageUrls: await this.media.resolveUrls(l.imageKeys),
      veterinarian: data.veterinarian,
      publishedAt: l.reviewedAt ?? l.createdAt,
    };
  }

  // --- create (approved vet only) --------------------------------

  async create(
    input: CreateVetServiceListingInput,
    actor: VetServiceActor,
  ): Promise<VetServiceListingDTO> {
    this.authz.assertApprovedVeterinarian(actor.principal);
    const imageKeys = await this.media.validateKeys(input.imageKeys ?? [], VET_SERVICE_MAX_IMAGES);

    const listing = await this.db.transaction(async (tx) => {
      const created = await this.listings.create(
        {
          ...input,
          details: (input.details ?? []).map((d) => d.trim()).filter(Boolean).slice(0, 12),
          imageKeys,
          veterinarianUserId: actor.principal.userId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: VetServiceAuditAction.LISTING_CREATED,
          entityType: VetServiceAuditEntity.LISTING,
          entityId: created.id,
          actorUserId: actor.principal.userId,
          metadata: { serviceType: created.serviceType, animalType: created.animalType },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish(VetServiceEvent.LISTING_SUBMITTED, {
      listingId: listing.id,
      veterinarianUserId: listing.veterinarianUserId,
    });
    return this.mustGetDTO(listing.id);
  }

  // --- reads -----------------------------------------------------

  async listPublic(
    filter: ListingBrowseFilter,
  ): Promise<{ items: PublicVetServiceListingDTO[]; total: number }> {
    const { items, total } = await this.listings.listPublic(filter);
    return { items: await Promise.all(items.map((i) => this.toPublicDTO(i))), total };
  }

  async getPublic(id: string): Promise<PublicVetServiceListingDTO> {
    const data = await this.listings.findWithVetById(id);
    if (!data || data.listing.status !== 'APPROVED') {
      throw new NotFoundError('Service listing not found');
    }
    return this.toPublicDTO(data);
  }

  async listMine(
    veterinarianUserId: string,
    filter: MineFilter,
  ): Promise<{ items: VetServiceListingDTO[]; total: number }> {
    const { items, total } = await this.listings.listMine(veterinarianUserId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  /** Owner or moderator full view (moderation metadata included). */
  async getForActor(id: string, actor: VetServiceActor): Promise<VetServiceListingDTO> {
    const data = await this.listings.findWithVetById(id);
    if (!data) throw new NotFoundError('Service listing not found');
    const isOwner = data.listing.veterinarianUserId === actor.principal.userId;
    const isModerator = await this.authz.isSystemSupervisorFor(
      actor.principal,
      VET_SERVICE_SUPERVISOR_DOMAIN,
    );
    if (!isOwner && !isModerator) throw new NotFoundError('Service listing not found');
    return this.toDTO(data);
  }

  // --- owner actions -------------------------------------------

  async remove(id: string, actor: VetServiceActor): Promise<void> {
    const existing = await this.listings.findById(id);
    if (!existing) throw new NotFoundError('Service listing not found');
    await this.assertOwnerOrModerator(existing, actor);
    await this.db.transaction(async (tx) => {
      await this.listings.deleteById(id, tx);
      await this.audit.record(
        {
          action: VetServiceAuditAction.LISTING_DELETED,
          entityType: VetServiceAuditEntity.LISTING,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { status: existing.status },
          context: actor.context,
        },
        tx,
      );
    });
  }

  async close(id: string, actor: VetServiceActor): Promise<VetServiceListingDTO> {
    const existing = await this.listings.findById(id);
    if (!existing) throw new NotFoundError('Service listing not found');
    VetServicePolicy.assertOwner(
      { ownerUserId: existing.veterinarianUserId },
      actor.principal.userId,
      'listing',
    );
    await this.db.transaction((tx) =>
      this.listings.update(id, { closedAt: new Date() }, tx).then(() =>
        this.audit.record(
          {
            action: VetServiceAuditAction.LISTING_CLOSED,
            entityType: VetServiceAuditEntity.LISTING,
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

  // --- moderation (ADMIN / VET_SERVICE supervisor) -------------

  async listForModeration(
    filter: ModerationFilter,
  ): Promise<{ items: VetServiceListingDTO[]; total: number }> {
    const { items, total } = await this.listings.listForModeration(filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForModeration(id: string): Promise<VetServiceListingDTO> {
    const data = await this.listings.findWithVetById(id);
    if (!data) throw new NotFoundError('Service listing not found');
    return this.toDTO(data);
  }

  approve(id: string, actor: VetServiceActor): Promise<VetServiceListingDTO> {
    return this.review(id, 'APPROVED', null, actor);
  }

  reject(id: string, reason: string, actor: VetServiceActor): Promise<VetServiceListingDTO> {
    return this.review(id, 'REJECTED', reason, actor);
  }

  private async review(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    reason: string | null,
    actor: VetServiceActor,
  ): Promise<VetServiceListingDTO> {
    const existing = await this.listings.findById(id);
    if (!existing) throw new NotFoundError('Service listing not found');
    VetServicePolicy.assertModerationPending(existing);

    await this.db.transaction(async (tx) => {
      await this.listings.update(
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
              ? VetServiceAuditAction.LISTING_APPROVED
              : VetServiceAuditAction.LISTING_REJECTED,
          entityType: VetServiceAuditEntity.LISTING,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: status === 'REJECTED' ? { reason } : {},
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish(
      status === 'APPROVED' ? VetServiceEvent.LISTING_APPROVED : VetServiceEvent.LISTING_REJECTED,
      {
        listingId: id,
        veterinarianUserId: existing.veterinarianUserId,
        actorUserId: actor.principal.userId,
        ...(status === 'REJECTED' ? { reason } : {}),
      },
    );
    return this.mustGetDTO(id);
  }

  // --- helpers -------------------------------------------------

  /** Internal — used by the listing-request service to gate submissions. */
  async loadEngageContext(
    id: string,
  ): Promise<{ id: string; veterinarianUserId: string; status: string; closedAt: string | null } | null> {
    const l = await this.listings.findById(id);
    return l
      ? { id: l.id, veterinarianUserId: l.veterinarianUserId, status: l.status, closedAt: l.closedAt }
      : null;
  }

  private async assertOwnerOrModerator(
    listing: VetServiceListing,
    actor: VetServiceActor,
  ): Promise<void> {
    if (listing.veterinarianUserId === actor.principal.userId) return;
    if (await this.authz.isSystemSupervisorFor(actor.principal, VET_SERVICE_SUPERVISOR_DOMAIN)) {
      return;
    }
    throw new ForbiddenError('Only the listing owner or a moderator can do this', {
      code: ErrorCode.PERMISSION_DENIED,
    });
  }

  private async mustGetDTO(id: string): Promise<VetServiceListingDTO> {
    const data = await this.listings.findWithVetById(id);
    if (!data) throw new NotFoundError('Service listing not found');
    return this.toDTO(data);
  }
}
