import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import type { ChatService } from '../../chat/application/chat.service.js';
import { VetJobAuditAction, VetJobAuditEntity, VetJobEvent } from '../domain/vet-job.constants.js';
import { VetJobPolicy } from '../domain/vet-job.policy.js';
import type {
  ApplicationListFilter,
  CreateVetJobApplicationInput,
  VetJobApplicationDTO,
} from '../domain/vet-job.types.js';
import type {
  VetJobApplicationJoined,
  VetJobApplicationRepository,
} from '../infrastructure/vet-job-application.repository.js';
import type { VetJobMedia } from './vet-job-media.js';
import type { VetJobOfferService } from './vet-job-offer.service.js';
import type { VetJobSeekerProfileService } from './vet-job-seeker-profile.service.js';

export interface VetJobActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * A veterinarian's APPLICATION against a job OFFER ("التقديم على الوظيفة").
 * PENDING until the offer's poster accepts / rejects. On accept, a chat
 * conversation is created (reusing the existing `PET_OWNER_VETERINARIAN`
 * conversation type, pinned to `VET_JOB_APPLICATION`) so poster and applicant
 * can talk. Only an approved veterinarian may apply.
 */
export class VetJobApplicationService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly applications: VetJobApplicationRepository,
    private readonly offers: VetJobOfferService,
    private readonly seekerProfiles: VetJobSeekerProfileService,
    private readonly media: VetJobMedia,
    private readonly authz: AuthorizationService,
    private readonly chat: ChatService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-job-application-service' });
  }

  private async toDTO(data: VetJobApplicationJoined): Promise<VetJobApplicationDTO> {
    const { cvStorageKey, photoStorageKey, ...rest } = data.application;
    return {
      ...rest,
      applicant: data.applicant,
      cvUrl: await this.media.resolveUrl(cvStorageKey),
      photoUrl: await this.media.resolveUrl(photoStorageKey),
      offer: data.offer,
    };
  }

  // --- apply (approved veterinarian only, not own offer) ---------------

  async apply(
    jobOfferId: string,
    input: CreateVetJobApplicationInput,
    actor: VetJobActor,
  ): Promise<VetJobApplicationDTO> {
    this.authz.assertApprovedVeterinarian(actor.principal);
    const offer = await this.offers.loadEngageContext(jobOfferId);
    if (!offer) throw new NotFoundError('Job offer not found');
    VetJobPolicy.assertOfferOpen(offer);
    VetJobPolicy.assertNotSelf(offer.postedByUserId, actor.principal.userId);

    const cvStorageKey = await this.media.validateKey(input.cvStorageKey);
    const photoStorageKey = await this.media.validateKey(input.photoStorageKey);

    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const created = await this.applications.create(
          { ...input, cvStorageKey, photoStorageKey, jobOfferId, applicantUserId: actor.principal.userId },
          tx,
        );
        await this.audit.record(
          {
            action: VetJobAuditAction.APPLICATION_SUBMITTED,
            entityType: VetJobAuditEntity.APPLICATION,
            entityId: created.id,
            actorUserId: actor.principal.userId,
            metadata: { jobOfferId },
            context: actor.context,
          },
          tx,
        );
        return created.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('You already applied to this job offer', {
          code: ErrorCode.VET_JOB_ALREADY_APPLIED,
        });
      }
      throw err;
    }

    this.events.publish(VetJobEvent.APPLICATION_RECEIVED, {
      applicationId: id,
      jobOfferId,
      posterUserId: offer.postedByUserId,
      applicantUserId: actor.principal.userId,
    });
    return this.mustGetDTO(id);
  }

  // --- reads -----------------------------------------------------

  /** Applications received across ALL of the caller's job offers ("طلبات التقديم الواردة"). */
  async listForPoster(
    actor: VetJobActor,
    filter: ApplicationListFilter,
  ): Promise<{ items: VetJobApplicationDTO[]; total: number }> {
    const { items, total } = await this.applications.listForPoster(actor.principal.userId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  /** Applications on ONE offer — the offer's poster only. */
  async listForOffer(
    jobOfferId: string,
    filter: ApplicationListFilter,
    actor: VetJobActor,
  ): Promise<{ items: VetJobApplicationDTO[]; total: number }> {
    const offer = await this.offers.loadEngageContext(jobOfferId);
    if (!offer || offer.postedByUserId !== actor.principal.userId) {
      throw new NotFoundError('Job offer not found');
    }
    const { items, total } = await this.applications.listForOffer(jobOfferId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  /** The caller's own submitted applications ("طلباتي"). */
  async listMine(
    actor: VetJobActor,
    filter: ApplicationListFilter,
  ): Promise<{ items: VetJobApplicationDTO[]; total: number }> {
    const { items, total } = await this.applications.listMine(actor.principal.userId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForActor(id: string, actor: VetJobActor): Promise<VetJobApplicationDTO> {
    const data = await this.applications.findJoinedById(id);
    if (!data) throw new NotFoundError('Application not found');
    const uid = actor.principal.userId;
    if (data.application.applicantUserId !== uid && data.offer?.postedByUserId !== uid) {
      throw new NotFoundError('Application not found');
    }
    return this.toDTO(data);
  }

  // --- moderation oversight (ADMIN / VET_JOBS supervisor, read-only) -----

  async listForModeration(
    filter: ApplicationListFilter,
  ): Promise<{ items: VetJobApplicationDTO[]; total: number }> {
    const { items, total } = await this.applications.listForModeration(filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  // --- poster responses ----------------------------------------

  /** The offer's poster accepts → a chat conversation is created + pinned. */
  async accept(id: string, actor: VetJobActor): Promise<VetJobApplicationDTO> {
    const data = await this.applications.findJoinedById(id);
    if (!data || data.offer?.postedByUserId !== actor.principal.userId) {
      throw new NotFoundError('Application not found');
    }
    VetJobPolicy.assertApplicationPending(data.application);

    const { conversation } = await this.chat.getOrCreateDeal(
      { actorUserId: actor.principal.userId, context: actor.context },
      {
        petOwnerUserId: actor.principal.userId,
        veterinarianUserId: data.application.applicantUserId,
        subjectType: 'VET_JOB_APPLICATION',
        subjectId: id,
      },
    );

    await this.db.transaction(async (tx) => {
      await this.applications.update(
        id,
        {
          status: 'ACCEPTED',
          reviewedByUserId: actor.principal.userId,
          reviewedAt: new Date(),
          conversationId: conversation.id,
        },
        tx,
      );
      await this.audit.record(
        {
          action: VetJobAuditAction.APPLICATION_STATUS_CHANGED,
          entityType: VetJobAuditEntity.APPLICATION,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { status: 'ACCEPTED', conversationId: conversation.id },
          context: actor.context,
        },
        tx,
      );
    });
    await this.chat.pinDealSubject(conversation.id, 'VET_JOB_APPLICATION', id);

    this.events.publish(VetJobEvent.APPLICATION_ACCEPTED, {
      applicationId: id,
      jobOfferId: data.application.jobOfferId,
      posterUserId: actor.principal.userId,
      applicantUserId: data.application.applicantUserId,
      conversationId: conversation.id,
    });
    return this.mustGetDTO(id);
  }

  async reject(id: string, actor: VetJobActor): Promise<VetJobApplicationDTO> {
    const data = await this.applications.findJoinedById(id);
    if (!data || data.offer?.postedByUserId !== actor.principal.userId) {
      throw new NotFoundError('Application not found');
    }
    VetJobPolicy.assertApplicationPending(data.application);

    await this.db.transaction(async (tx) => {
      await this.applications.update(
        id,
        { status: 'REJECTED', reviewedByUserId: actor.principal.userId, reviewedAt: new Date() },
        tx,
      );
      await this.audit.record(
        {
          action: VetJobAuditAction.APPLICATION_STATUS_CHANGED,
          entityType: VetJobAuditEntity.APPLICATION,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { status: 'REJECTED' },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish(VetJobEvent.APPLICATION_REJECTED, {
      applicationId: id,
      jobOfferId: data.application.jobOfferId,
      posterUserId: actor.principal.userId,
      applicantUserId: data.application.applicantUserId,
    });
    return this.mustGetDTO(id);
  }

  // --- direct contact: "تواصل مع الطبيب" from a seeker-profile view ------

  /**
   * Any user views an APPROVED job-seeker profile and opens a direct chat
   * with that veterinarian — BEFORE any formal application exists. Reuses
   * the exact `PET_OWNER_VETERINARIAN` deal-chat seam from `vet-services`,
   * with no `subjectType` (a plain, unpinned thread). Idempotent.
   */
  async startConversationWithSeeker(
    seekerProfileId: string,
    actor: VetJobActor,
  ): Promise<{ conversationId: string }> {
    const profile = await this.seekerProfiles.loadContactContext(seekerProfileId);
    if (!profile || profile.status !== 'APPROVED' || profile.closedAt !== null) {
      throw new NotFoundError('Job-seeker profile not found');
    }
    if (profile.userId === actor.principal.userId) {
      throw new ForbiddenError('You cannot chat with yourself', { code: ErrorCode.PERMISSION_DENIED });
    }
    const { conversation } = await this.chat.getOrCreateDeal(
      { actorUserId: actor.principal.userId, context: actor.context },
      { petOwnerUserId: actor.principal.userId, veterinarianUserId: profile.userId },
    );
    return { conversationId: conversation.id };
  }

  private async mustGetDTO(id: string): Promise<VetJobApplicationDTO> {
    const data = await this.applications.findJoinedById(id);
    if (!data) throw new NotFoundError('Application not found');
    return this.toDTO(data);
  }
}
