import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import { VET_JOB_SUPERVISOR_DOMAIN, VetJobAuditAction, VetJobAuditEntity, VetJobEvent } from '../domain/vet-job.constants.js';
import { VetJobPolicy } from '../domain/vet-job.policy.js';
import type {
  CreateVetJobSeekerProfileInput,
  ModerationFilter,
  PublicVetJobSeekerProfileDTO,
  SeekerBrowseFilter,
  UpdateVetJobSeekerProfileInput,
  VetJobSeekerProfile,
  VetJobSeekerProfileDTO,
} from '../domain/vet-job.types.js';
import type {
  VetJobSeekerProfileRepository,
  VetJobSeekerProfileWithUser,
} from '../infrastructure/vet-job-seeker-profile.repository.js';
import type { VetJobMedia } from './vet-job-media.js';

export interface VetJobActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

/**
 * Veterinarian "looking for a job" profiles ("باحثون عن عمل"). One profile per
 * user. Starts PENDING and is NOT public until an ADMIN or a VET_JOBS
 * system-supervisor approves it. Only an approved veterinarian may create or
 * edit their own profile.
 */
export class VetJobSeekerProfileService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly profiles: VetJobSeekerProfileRepository,
    private readonly media: VetJobMedia,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-job-seeker-profile-service' });
  }

  private async toDTO(data: VetJobSeekerProfileWithUser): Promise<VetJobSeekerProfileDTO> {
    const { cvStorageKey, photoStorageKey, ...rest } = data.profile;
    return {
      ...rest,
      user: data.user,
      cvUrl: await this.media.resolveUrl(cvStorageKey),
      photoUrl: await this.media.resolveUrl(photoStorageKey),
    };
  }

  private async toPublicDTO(data: VetJobSeekerProfileWithUser): Promise<PublicVetJobSeekerProfileDTO> {
    const p = data.profile;
    return {
      id: p.id,
      specialty: p.specialty,
      headline: p.headline,
      experienceYears: p.experienceYears,
      governorate: p.governorate,
      district: p.district,
      qualifications: p.qualifications,
      skills: p.skills,
      preferredEmploymentTypes: p.preferredEmploymentTypes,
      photoUrl: await this.media.resolveUrl(p.photoStorageKey),
      cvUrl: await this.media.resolveUrl(p.cvStorageKey),
      user: data.user,
      publishedAt: p.reviewedAt ?? p.createdAt,
    };
  }

  // --- create / update own profile (approved veterinarian only) ---------

  async createMine(
    input: CreateVetJobSeekerProfileInput,
    actor: VetJobActor,
  ): Promise<VetJobSeekerProfileDTO> {
    this.authz.assertApprovedVeterinarian(actor.principal);
    const existing = await this.profiles.findByUserId(actor.principal.userId);
    if (existing) {
      throw new ConflictError('You already have a job-seeker profile — update it instead', {
        code: ErrorCode.CONFLICT,
      });
    }
    const cvStorageKey = await this.media.validateKey(input.cvStorageKey);
    const photoStorageKey = await this.media.validateKey(input.photoStorageKey);

    const created = await this.db.transaction(async (tx) => {
      const profile = await this.profiles.create(
        { ...input, cvStorageKey, photoStorageKey, userId: actor.principal.userId },
        tx,
      );
      await this.audit.record(
        {
          action: VetJobAuditAction.SEEKER_PROFILE_CREATED,
          entityType: VetJobAuditEntity.SEEKER_PROFILE,
          entityId: profile.id,
          actorUserId: actor.principal.userId,
          metadata: { specialty: profile.specialty },
          context: actor.context,
        },
        tx,
      );
      return profile;
    });

    this.events.publish(VetJobEvent.SEEKER_PROFILE_SUBMITTED, {
      profileId: created.id,
      userId: created.userId,
    });
    return this.mustGetDTO(created.id);
  }

  async updateMine(
    patch: UpdateVetJobSeekerProfileInput,
    actor: VetJobActor,
  ): Promise<VetJobSeekerProfileDTO> {
    const existing = await this.profiles.findByUserId(actor.principal.userId);
    if (!existing) throw new NotFoundError('Job-seeker profile not found');

    const cvStorageKey =
      patch.cvStorageKey !== undefined ? await this.media.validateKey(patch.cvStorageKey) : undefined;
    const photoStorageKey =
      patch.photoStorageKey !== undefined ? await this.media.validateKey(patch.photoStorageKey) : undefined;

    await this.db.transaction(async (tx) => {
      const dbPatch: Parameters<VetJobSeekerProfileRepository['update']>[1] = {
        ...patch,
        cvStorageKey,
        photoStorageKey,
      };
      if (existing.status === 'REJECTED') {
        dbPatch.status = 'PENDING';
        dbPatch.reviewedByUserId = null;
        dbPatch.reviewedAt = null;
        dbPatch.rejectionReason = null;
      }
      await this.profiles.update(existing.id, dbPatch, tx);
      await this.audit.record(
        {
          action: VetJobAuditAction.SEEKER_PROFILE_UPDATED,
          entityType: VetJobAuditEntity.SEEKER_PROFILE,
          entityId: existing.id,
          actorUserId: actor.principal.userId,
          metadata: { fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
    });
    return this.mustGetDTO(existing.id);
  }

  /** "إيقاف الإعلان" — the veterinarian pauses their own approved profile. */
  async deactivateMine(actor: VetJobActor): Promise<VetJobSeekerProfileDTO> {
    const existing = await this.profiles.findByUserId(actor.principal.userId);
    if (!existing) throw new NotFoundError('Job-seeker profile not found');
    await this.db.transaction((tx) =>
      this.profiles.update(existing.id, { closedAt: new Date() }, tx).then(() =>
        this.audit.record(
          {
            action: VetJobAuditAction.SEEKER_PROFILE_DEACTIVATED,
            entityType: VetJobAuditEntity.SEEKER_PROFILE,
            entityId: existing.id,
            actorUserId: actor.principal.userId,
            context: actor.context,
          },
          tx,
        ),
      ),
    );
    return this.mustGetDTO(existing.id);
  }

  // --- reads -----------------------------------------------------

  async listPublic(
    filter: SeekerBrowseFilter,
  ): Promise<{ items: PublicVetJobSeekerProfileDTO[]; total: number }> {
    const { items, total } = await this.profiles.listPublic(filter);
    return { items: await Promise.all(items.map((i) => this.toPublicDTO(i))), total };
  }

  async getPublic(id: string): Promise<PublicVetJobSeekerProfileDTO> {
    const data = await this.profiles.findWithUserById(id);
    if (!data || data.profile.status !== 'APPROVED') throw new NotFoundError('Job-seeker profile not found');
    return this.toPublicDTO(data);
  }

  async getMine(actor: VetJobActor): Promise<VetJobSeekerProfileDTO | null> {
    const existing = await this.profiles.findByUserId(actor.principal.userId);
    return existing ? this.mustGetDTO(existing.id) : null;
  }

  /** Internal — used by the application service to load the applicant's own profile summary. */
  async loadContactContext(id: string): Promise<VetJobSeekerProfile | null> {
    return this.profiles.findById(id);
  }

  // --- moderation (ADMIN / VET_JOBS supervisor) -------------

  async listForModeration(
    filter: ModerationFilter,
  ): Promise<{ items: VetJobSeekerProfileDTO[]; total: number }> {
    const { items, total } = await this.profiles.listForModeration(filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForModeration(id: string): Promise<VetJobSeekerProfileDTO> {
    const data = await this.profiles.findWithUserById(id);
    if (!data) throw new NotFoundError('Job-seeker profile not found');
    return this.toDTO(data);
  }

  approve(id: string, actor: VetJobActor): Promise<VetJobSeekerProfileDTO> {
    return this.review(id, 'APPROVED', null, actor);
  }

  reject(id: string, reason: string, actor: VetJobActor): Promise<VetJobSeekerProfileDTO> {
    return this.review(id, 'REJECTED', reason, actor);
  }

  private async review(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    reason: string | null,
    actor: VetJobActor,
  ): Promise<VetJobSeekerProfileDTO> {
    const existing = await this.profiles.findById(id);
    if (!existing) throw new NotFoundError('Job-seeker profile not found');
    VetJobPolicy.assertModerationPending(existing);

    await this.db.transaction(async (tx) => {
      await this.profiles.update(
        id,
        { status, reviewedByUserId: actor.principal.userId, reviewedAt: new Date(), rejectionReason: reason },
        tx,
      );
      await this.audit.record(
        {
          action:
            status === 'APPROVED'
              ? VetJobAuditAction.SEEKER_PROFILE_APPROVED
              : VetJobAuditAction.SEEKER_PROFILE_REJECTED,
          entityType: VetJobAuditEntity.SEEKER_PROFILE,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: status === 'REJECTED' ? { reason } : {},
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish(
      status === 'APPROVED' ? VetJobEvent.SEEKER_PROFILE_APPROVED : VetJobEvent.SEEKER_PROFILE_REJECTED,
      {
        profileId: id,
        userId: existing.userId,
        actorUserId: actor.principal.userId,
        ...(status === 'REJECTED' ? { reason } : {}),
      },
    );
    return this.mustGetDTO(id);
  }

  // --- helpers -----------------------------------------------------

  /** Only ADMIN or a VET_JOBS supervisor may view a non-approved profile. */
  async assertVisibleOrModerator(profile: VetJobSeekerProfile, actor: VetJobActor): Promise<void> {
    if (profile.userId === actor.principal.userId) return;
    if (profile.status === 'APPROVED' && profile.closedAt === null) return;
    if (await this.authz.isSystemSupervisorFor(actor.principal, VET_JOB_SUPERVISOR_DOMAIN)) return;
    throw new ForbiddenError('This profile is not visible', { code: ErrorCode.PERMISSION_DENIED });
  }

  private async mustGetDTO(id: string): Promise<VetJobSeekerProfileDTO> {
    const data = await this.profiles.findWithUserById(id);
    if (!data) throw new NotFoundError('Job-seeker profile not found');
    return this.toDTO(data);
  }
}
