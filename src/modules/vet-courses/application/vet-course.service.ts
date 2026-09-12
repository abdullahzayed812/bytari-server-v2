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
  VET_COURSE_SUPERVISOR_DOMAIN,
  VetCourseAuditAction,
  VetCourseAuditEntity,
  VetCourseEvent,
} from '../domain/vet-course.constants.js';
import { VetCoursePolicy } from '../domain/vet-course.policy.js';
import type {
  CourseBrowseFilter,
  CreateVetCourseInput,
  MineFilter,
  ModerationFilter,
  PublicVetCourseDTO,
  UpdateVetCourseInput,
  VetCourse,
  VetCourseDTO,
} from '../domain/vet-course.types.js';
import type { VetCourseRepository, VetCourseWithCreator } from '../infrastructure/vet-course.repository.js';
import type { VetCourseMedia } from './vet-course-media.js';

export interface VetCourseActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

function trimList(list: string[] | undefined): string[] {
  return (list ?? []).map((d) => d.trim()).filter(Boolean).slice(0, 20);
}

/**
 * Veterinarian-created COURSE / SEMINAR / WORKSHOP ("الدورات والندوات").
 * Starts PENDING and is NOT public until an ADMIN or a VET_COURSES
 * system-supervisor approves it — the same reusable moderation lifecycle as
 * `vet-services` / `vet-jobs`. Only an approved veterinarian may create one.
 */
export class VetCourseService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly courses: VetCourseRepository,
    private readonly media: VetCourseMedia,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-course-service' });
  }

  private async toDTO(data: VetCourseWithCreator): Promise<VetCourseDTO> {
    const { coverImageStorageKey, ...rest } = data.course;
    return {
      ...rest,
      creator: data.creator,
      coverImageUrl: await this.media.resolveUrl(coverImageStorageKey),
      registrationCount: data.registrationCount,
    };
  }

  private async toPublicDTO(
    data: VetCourseWithCreator,
    registrationCount: number,
  ): Promise<PublicVetCourseDTO> {
    const c = data.course;
    return {
      id: c.id,
      type: c.type,
      title: c.title,
      description: c.description,
      organizingBody: c.organizingBody,
      instructorName: c.instructorName,
      instructorSpecialty: c.instructorSpecialty,
      startDate: c.startDate,
      endDate: c.endDate,
      startTime: c.startTime,
      endTime: c.endTime,
      timezoneNote: c.timezoneNote,
      locationMode: c.locationMode,
      locationDetails: c.locationDetails,
      capacity: c.capacity,
      remainingSeats: c.capacity !== null ? Math.max(0, c.capacity - registrationCount) : null,
      price: c.price,
      registrationDeadline: c.registrationDeadline,
      topics: c.topics,
      coverImageUrl: await this.media.resolveUrl(c.coverImageStorageKey),
      publishedAt: c.reviewedAt ?? c.createdAt,
    };
  }

  // --- create (approved veterinarian only) --------------------------------

  async create(input: CreateVetCourseInput, actor: VetCourseActor): Promise<VetCourseDTO> {
    this.authz.assertApprovedVeterinarian(actor.principal);
    const coverImageStorageKey = await this.media.validateKey(input.coverImageStorageKey);

    const course = await this.db.transaction(async (tx) => {
      const created = await this.courses.create(
        {
          ...input,
          topics: trimList(input.topics),
          coverImageStorageKey,
          creatorUserId: actor.principal.userId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: VetCourseAuditAction.CREATED,
          entityType: VetCourseAuditEntity.COURSE,
          entityId: created.id,
          actorUserId: actor.principal.userId,
          metadata: { title: created.title, type: created.type },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish(VetCourseEvent.SUBMITTED, {
      courseId: course.id,
      creatorUserId: course.creatorUserId,
      title: course.title,
    });
    return this.mustGetDTO(course.id);
  }

  // --- reads -----------------------------------------------------

  async listPublic(filter: CourseBrowseFilter): Promise<{ items: PublicVetCourseDTO[]; total: number }> {
    const { items, total } = await this.courses.listPublic(filter);
    const counts = await Promise.all(items.map((i) => this.courses.registrationCount(i.course.id)));
    return { items: await Promise.all(items.map((i, idx) => this.toPublicDTO(i, counts[idx] ?? 0))), total };
  }

  async getPublic(id: string): Promise<PublicVetCourseDTO> {
    const data = await this.courses.findWithCreatorById(id);
    if (!data || data.course.status !== 'APPROVED' || data.course.cancelledAt !== null) {
      throw new NotFoundError('Course not found');
    }
    const count = await this.courses.registrationCount(id);
    return this.toPublicDTO(data, count);
  }

  async listMine(
    creatorUserId: string,
    filter: MineFilter,
  ): Promise<{ items: VetCourseDTO[]; total: number }> {
    const { items, total } = await this.courses.listMine(creatorUserId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  /** Owner or moderator full view (moderation metadata + registration count). */
  async getForActor(id: string, actor: VetCourseActor): Promise<VetCourseDTO> {
    const data = await this.courses.findWithCreatorAndCountById(id);
    if (!data) throw new NotFoundError('Course not found');
    const isOwner = data.course.creatorUserId === actor.principal.userId;
    const isModerator = await this.authz.isSystemSupervisorFor(actor.principal, VET_COURSE_SUPERVISOR_DOMAIN);
    if (!isOwner && !isModerator) throw new NotFoundError('Course not found');
    return this.toDTO(data);
  }

  // --- owner actions -------------------------------------------

  async update(id: string, patch: UpdateVetCourseInput, actor: VetCourseActor): Promise<VetCourseDTO> {
    const existing = await this.courses.findById(id);
    if (!existing) throw new NotFoundError('Course not found');
    VetCoursePolicy.assertOwner({ creatorUserId: existing.creatorUserId }, actor.principal.userId, 'course');

    const coverImageStorageKey =
      patch.coverImageStorageKey !== undefined
        ? await this.media.validateKey(patch.coverImageStorageKey)
        : undefined;

    await this.db.transaction(async (tx) => {
      const dbPatch: Parameters<VetCourseRepository['update']>[1] = {
        ...patch,
        topics: patch.topics ? trimList(patch.topics) : undefined,
        coverImageStorageKey,
      };
      // A previously-rejected course goes back to PENDING for re-review on edit.
      if (existing.status === 'REJECTED') {
        dbPatch.status = 'PENDING';
        dbPatch.reviewedByUserId = null;
        dbPatch.reviewedAt = null;
        dbPatch.rejectionReason = null;
      }
      await this.courses.update(id, dbPatch, tx);
      await this.audit.record(
        {
          action: VetCourseAuditAction.UPDATED,
          entityType: VetCourseAuditEntity.COURSE,
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

  async remove(id: string, actor: VetCourseActor): Promise<void> {
    const existing = await this.courses.findById(id);
    if (!existing) throw new NotFoundError('Course not found');
    await this.assertOwnerOrModerator(existing, actor);
    await this.db.transaction(async (tx) => {
      await this.courses.deleteById(id, tx);
      await this.audit.record(
        {
          action: VetCourseAuditAction.DELETED,
          entityType: VetCourseAuditEntity.COURSE,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { status: existing.status },
          context: actor.context,
        },
        tx,
      );
    });
  }

  /** The creator (or a moderator) cancels an APPROVED course — "إلغاء الدورة". */
  async cancel(id: string, actor: VetCourseActor): Promise<VetCourseDTO> {
    const existing = await this.courses.findById(id);
    if (!existing) throw new NotFoundError('Course not found');
    await this.assertOwnerOrModerator(existing, actor);
    await this.db.transaction((tx) =>
      this.courses.update(id, { cancelledAt: new Date() }, tx).then(() =>
        this.audit.record(
          {
            action: VetCourseAuditAction.CANCELLED,
            entityType: VetCourseAuditEntity.COURSE,
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

  // --- moderation (ADMIN / VET_COURSES supervisor) -------------

  async listForModeration(filter: ModerationFilter): Promise<{ items: VetCourseDTO[]; total: number }> {
    const { items, total } = await this.courses.listForModeration(filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForModeration(id: string): Promise<VetCourseDTO> {
    const data = await this.courses.findWithCreatorAndCountById(id);
    if (!data) throw new NotFoundError('Course not found');
    return this.toDTO(data);
  }

  approve(id: string, actor: VetCourseActor): Promise<VetCourseDTO> {
    return this.review(id, 'APPROVED', null, actor);
  }

  reject(id: string, reason: string, actor: VetCourseActor): Promise<VetCourseDTO> {
    return this.review(id, 'REJECTED', reason, actor);
  }

  private async review(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    reason: string | null,
    actor: VetCourseActor,
  ): Promise<VetCourseDTO> {
    const existing = await this.courses.findById(id);
    if (!existing) throw new NotFoundError('Course not found');
    VetCoursePolicy.assertModerationPending(existing);

    await this.db.transaction(async (tx) => {
      await this.courses.update(
        id,
        { status, reviewedByUserId: actor.principal.userId, reviewedAt: new Date(), rejectionReason: reason },
        tx,
      );
      await this.audit.record(
        {
          action: status === 'APPROVED' ? VetCourseAuditAction.APPROVED : VetCourseAuditAction.REJECTED,
          entityType: VetCourseAuditEntity.COURSE,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: status === 'REJECTED' ? { reason } : {},
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish(status === 'APPROVED' ? VetCourseEvent.APPROVED : VetCourseEvent.REJECTED, {
      courseId: id,
      creatorUserId: existing.creatorUserId,
      title: existing.title,
      actorUserId: actor.principal.userId,
      ...(status === 'REJECTED' ? { reason } : {}),
    });
    return this.mustGetDTO(id);
  }

  // --- helpers -------------------------------------------------

  /** Internal — used by the registration service to gate submissions. */
  async loadEngageContext(id: string): Promise<VetCourse | null> {
    return this.courses.findById(id);
  }

  private async assertOwnerOrModerator(course: VetCourse, actor: VetCourseActor): Promise<void> {
    if (course.creatorUserId === actor.principal.userId) return;
    if (await this.authz.isSystemSupervisorFor(actor.principal, VET_COURSE_SUPERVISOR_DOMAIN)) return;
    throw new ForbiddenError('Only the course owner or a moderator can do this', {
      code: ErrorCode.PERMISSION_DENIED,
    });
  }

  private async mustGetDTO(id: string): Promise<VetCourseDTO> {
    const data = await this.courses.findWithCreatorAndCountById(id);
    if (!data) throw new NotFoundError('Course not found');
    return this.toDTO(data);
  }
}
