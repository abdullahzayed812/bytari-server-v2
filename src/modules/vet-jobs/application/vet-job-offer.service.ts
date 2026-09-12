import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import { VET_JOB_SUPERVISOR_DOMAIN, VetJobAuditAction, VetJobAuditEntity, VetJobEvent } from '../domain/vet-job.constants.js';
import { VetJobPolicy } from '../domain/vet-job.policy.js';
import type {
  CreateVetJobOfferInput,
  MineFilter,
  ModerationFilter,
  OfferBrowseFilter,
  PublicVetJobOfferDTO,
  UpdateVetJobOfferInput,
  VetJobOffer,
  VetJobOfferDTO,
} from '../domain/vet-job.types.js';
import type { VetJobOfferRepository, VetJobOfferWithPoster } from '../infrastructure/vet-job-offer.repository.js';

export interface VetJobActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

function trimList(list: string[] | undefined): string[] {
  return (list ?? []).map((d) => d.trim()).filter(Boolean).slice(0, 20);
}

/**
 * Employer-posted job OFFERS. Starts PENDING and is NOT public until an ADMIN
 * or a VET_JOBS system-supervisor approves it — the same reusable moderation
 * lifecycle as `vet-services`. Any authenticated user may post one (mirrors
 * `vet-services` requests); only applying / creating a seeker profile is
 * restricted to approved veterinarians.
 */
export class VetJobOfferService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly offers: VetJobOfferRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-job-offer-service' });
  }

  private toDTO(data: VetJobOfferWithPoster): VetJobOfferDTO {
    return { ...data.offer, postedBy: data.postedBy, applicationCount: data.applicationCount };
  }

  private toPublicDTO(data: VetJobOfferWithPoster): PublicVetJobOfferDTO {
    const o = data.offer;
    return {
      id: o.id,
      organizationName: o.organizationName,
      title: o.title,
      employmentType: o.employmentType,
      governorate: o.governorate,
      district: o.district,
      salaryAmount: o.salaryAmount,
      salaryNegotiable: o.salaryNegotiable,
      experienceYearsRequired: o.experienceYearsRequired,
      qualifications: o.qualifications,
      description: o.description,
      responsibilities: o.responsibilities,
      requirements: o.requirements,
      benefits: o.benefits,
      contactPhone: o.contactPhone,
      contactEmail: o.contactEmail,
      applicationDeadline: o.applicationDeadline,
      publishedAt: o.reviewedAt ?? o.createdAt,
    };
  }

  // --- create (any authenticated user) --------------------------------

  async create(input: CreateVetJobOfferInput, actor: VetJobActor): Promise<VetJobOfferDTO> {
    const offer = await this.db.transaction(async (tx) => {
      const created = await this.offers.create(
        {
          ...input,
          responsibilities: trimList(input.responsibilities),
          requirements: trimList(input.requirements),
          benefits: trimList(input.benefits),
          postedByUserId: actor.principal.userId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: VetJobAuditAction.OFFER_CREATED,
          entityType: VetJobAuditEntity.OFFER,
          entityId: created.id,
          actorUserId: actor.principal.userId,
          metadata: { title: created.title },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish(VetJobEvent.OFFER_SUBMITTED, {
      offerId: offer.id,
      postedByUserId: offer.postedByUserId,
    });
    return this.mustGetDTO(offer.id);
  }

  // --- reads -----------------------------------------------------

  async listPublic(filter: OfferBrowseFilter): Promise<{ items: PublicVetJobOfferDTO[]; total: number }> {
    const { items, total } = await this.offers.listPublic(filter);
    return { items: items.map((i) => this.toPublicDTO(i)), total };
  }

  async getPublic(id: string): Promise<PublicVetJobOfferDTO> {
    const data = await this.offers.findWithPosterById(id);
    if (!data || data.offer.status !== 'APPROVED') throw new NotFoundError('Job offer not found');
    return this.toPublicDTO(data);
  }

  async listMine(
    postedByUserId: string,
    filter: MineFilter,
  ): Promise<{ items: VetJobOfferDTO[]; total: number }> {
    const { items, total } = await this.offers.listMine(postedByUserId, filter);
    return { items: items.map((i) => this.toDTO(i)), total };
  }

  /** Owner or moderator full view (moderation metadata + application count). */
  async getForActor(id: string, actor: VetJobActor): Promise<VetJobOfferDTO> {
    const data = await this.offers.findWithPosterAndCountById(id);
    if (!data) throw new NotFoundError('Job offer not found');
    const isOwner = data.offer.postedByUserId === actor.principal.userId;
    const isModerator = await this.authz.isSystemSupervisorFor(actor.principal, VET_JOB_SUPERVISOR_DOMAIN);
    if (!isOwner && !isModerator) throw new NotFoundError('Job offer not found');
    return this.toDTO(data);
  }

  // --- owner actions -------------------------------------------

  async update(id: string, patch: UpdateVetJobOfferInput, actor: VetJobActor): Promise<VetJobOfferDTO> {
    const existing = await this.offers.findById(id);
    if (!existing) throw new NotFoundError('Job offer not found');
    VetJobPolicy.assertOwner({ ownerUserId: existing.postedByUserId }, actor.principal.userId, 'job offer');

    await this.db.transaction(async (tx) => {
      const dbPatch: Parameters<VetJobOfferRepository['update']>[1] = {
        ...patch,
        responsibilities: patch.responsibilities ? trimList(patch.responsibilities) : undefined,
        requirements: patch.requirements ? trimList(patch.requirements) : undefined,
        benefits: patch.benefits ? trimList(patch.benefits) : undefined,
      };
      // A previously-rejected offer goes back to PENDING for re-review on edit.
      if (existing.status === 'REJECTED') {
        dbPatch.status = 'PENDING';
        dbPatch.reviewedByUserId = null;
        dbPatch.reviewedAt = null;
        dbPatch.rejectionReason = null;
      }
      await this.offers.update(id, dbPatch, tx);
      await this.audit.record(
        {
          action: VetJobAuditAction.OFFER_UPDATED,
          entityType: VetJobAuditEntity.OFFER,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
    });
    return this.mustGetDTO(id);
  }

  async remove(id: string, actor: VetJobActor): Promise<void> {
    const existing = await this.offers.findById(id);
    if (!existing) throw new NotFoundError('Job offer not found');
    await this.assertOwnerOrModerator(existing, actor);
    await this.db.transaction(async (tx) => {
      await this.offers.deleteById(id, tx);
      await this.audit.record(
        {
          action: VetJobAuditAction.OFFER_DELETED,
          entityType: VetJobAuditEntity.OFFER,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { status: existing.status },
          context: actor.context,
        },
        tx,
      );
    });
  }

  /** "إلغاء الإعلان" — the poster closes their own ad early. */
  async close(id: string, actor: VetJobActor): Promise<VetJobOfferDTO> {
    const existing = await this.offers.findById(id);
    if (!existing) throw new NotFoundError('Job offer not found');
    VetJobPolicy.assertOwner({ ownerUserId: existing.postedByUserId }, actor.principal.userId, 'job offer');
    await this.db.transaction((tx) =>
      this.offers.update(id, { closedAt: new Date() }, tx).then(() =>
        this.audit.record(
          {
            action: VetJobAuditAction.OFFER_CLOSED,
            entityType: VetJobAuditEntity.OFFER,
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

  // --- moderation (ADMIN / VET_JOBS supervisor) -------------

  async listForModeration(filter: ModerationFilter): Promise<{ items: VetJobOfferDTO[]; total: number }> {
    const { items, total } = await this.offers.listForModeration(filter);
    return { items: items.map((i) => this.toDTO(i)), total };
  }

  async getForModeration(id: string): Promise<VetJobOfferDTO> {
    const data = await this.offers.findWithPosterAndCountById(id);
    if (!data) throw new NotFoundError('Job offer not found');
    return this.toDTO(data);
  }

  approve(id: string, actor: VetJobActor): Promise<VetJobOfferDTO> {
    return this.review(id, 'APPROVED', null, actor);
  }

  reject(id: string, reason: string, actor: VetJobActor): Promise<VetJobOfferDTO> {
    return this.review(id, 'REJECTED', reason, actor);
  }

  private async review(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    reason: string | null,
    actor: VetJobActor,
  ): Promise<VetJobOfferDTO> {
    const existing = await this.offers.findById(id);
    if (!existing) throw new NotFoundError('Job offer not found');
    VetJobPolicy.assertModerationPending(existing);

    await this.db.transaction(async (tx) => {
      await this.offers.update(
        id,
        { status, reviewedByUserId: actor.principal.userId, reviewedAt: new Date(), rejectionReason: reason },
        tx,
      );
      await this.audit.record(
        {
          action: status === 'APPROVED' ? VetJobAuditAction.OFFER_APPROVED : VetJobAuditAction.OFFER_REJECTED,
          entityType: VetJobAuditEntity.OFFER,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: status === 'REJECTED' ? { reason } : {},
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish(status === 'APPROVED' ? VetJobEvent.OFFER_APPROVED : VetJobEvent.OFFER_REJECTED, {
      offerId: id,
      postedByUserId: existing.postedByUserId,
      actorUserId: actor.principal.userId,
      ...(status === 'REJECTED' ? { reason } : {}),
    });
    return this.mustGetDTO(id);
  }

  // --- helpers -------------------------------------------------

  /** Internal — used by the application service to gate submissions. */
  async loadEngageContext(id: string): Promise<VetJobOffer | null> {
    return this.offers.findById(id);
  }

  private async assertOwnerOrModerator(offer: VetJobOffer, actor: VetJobActor): Promise<void> {
    if (offer.postedByUserId === actor.principal.userId) return;
    if (await this.authz.isSystemSupervisorFor(actor.principal, VET_JOB_SUPERVISOR_DOMAIN)) return;
    throw new ForbiddenError('Only the job offer owner or a moderator can do this', {
      code: ErrorCode.PERMISSION_DENIED,
    });
  }

  private async mustGetDTO(id: string): Promise<VetJobOfferDTO> {
    const data = await this.offers.findWithPosterAndCountById(id);
    if (!data) throw new NotFoundError('Job offer not found');
    return this.toDTO(data);
  }
}
