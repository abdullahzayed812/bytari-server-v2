import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import {
  VetCourseAuditAction,
  VetCourseAuditEntity,
  VetCourseEvent,
  type VetCourseLocationMode,
  type VetCourseType,
} from '../domain/vet-course.constants.js';
import { VetCoursePolicy } from '../domain/vet-course.policy.js';
import type {
  CreateVetCourseRegistrationInput,
  RegistrationListFilter,
  VetCourseRegistrationDTO,
} from '../domain/vet-course.types.js';
import type {
  VetCourseRegistrationJoined,
  VetCourseRegistrationRepository,
} from '../infrastructure/vet-course-registration.repository.js';
import type { VetCourseRepository } from '../infrastructure/vet-course.repository.js';
import type { VetCourseMedia } from './vet-course-media.js';
import type { VetCourseService } from './vet-course.service.js';

export interface VetCourseActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * A veterinarian's REGISTRATION for an approved COURSE / SEMINAR / WORKSHOP.
 * No moderation of its own — enforced synchronously at registration time:
 * only an approved veterinarian, on an open (APPROVED, not cancelled, before
 * its deadline) course, respecting `capacity` when set, at most once per
 * course (DB unique index on `(course_id, registrant_user_id)`).
 */
export class VetCourseRegistrationService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly registrations: VetCourseRegistrationRepository,
    private readonly courseRepo: VetCourseRepository,
    private readonly courses: VetCourseService,
    private readonly media: VetCourseMedia,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vet-course-registration-service' });
  }

  private async toDTO(data: VetCourseRegistrationJoined): Promise<VetCourseRegistrationDTO> {
    const { registration, registrant, course } = data;
    return {
      ...registration,
      registrant,
      course: course
        ? {
            id: course.id,
            title: course.title,
            type: course.type as VetCourseType,
            startDate: course.startDate,
            endDate: course.endDate,
            locationMode: course.locationMode as VetCourseLocationMode,
            organizingBody: course.organizingBody,
            coverImageUrl: await this.media.resolveUrl(course.coverImageStorageKey),
            cancelledAt: course.cancelledAt,
          }
        : undefined,
    };
  }

  // --- register (approved veterinarian only, not own course) ---------------

  async register(
    courseId: string,
    input: CreateVetCourseRegistrationInput,
    actor: VetCourseActor,
  ): Promise<VetCourseRegistrationDTO> {
    this.authz.assertApprovedVeterinarian(actor.principal);
    const course = await this.courses.loadEngageContext(courseId);
    if (!course) throw new NotFoundError('Course not found');
    VetCoursePolicy.assertRegistrationOpen(course);
    VetCoursePolicy.assertNotSelf(course.creatorUserId, actor.principal.userId);

    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        // Lock the course row so concurrent registrations serialize on the capacity check.
        const locked = await this.courseRepo.findByIdForUpdate(courseId, tx);
        if (!locked) throw new NotFoundError('Course not found');
        const current = await this.courseRepo.registrationCount(courseId, tx);
        VetCoursePolicy.assertCapacityAvailable(locked, current);

        const created = await this.registrations.create(
          { ...input, courseId, registrantUserId: actor.principal.userId },
          tx,
        );
        await this.audit.record(
          {
            action: VetCourseAuditAction.REGISTRATION_CREATED,
            entityType: VetCourseAuditEntity.REGISTRATION,
            entityId: created.id,
            actorUserId: actor.principal.userId,
            metadata: { courseId },
            context: actor.context,
          },
          tx,
        );
        return created.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('You already registered for this course', {
          code: ErrorCode.VET_COURSE_ALREADY_REGISTERED,
        });
      }
      throw err;
    }

    this.events.publish(VetCourseEvent.REGISTERED, {
      registrationId: id,
      courseId,
      courseTitle: course.title,
      creatorUserId: course.creatorUserId,
      registrantUserId: actor.principal.userId,
    });
    return this.mustGetDTO(id);
  }

  // --- reads -----------------------------------------------------

  /** Registrants of ONE course — the course's creator (or a moderator) only. */
  async listForCourse(
    courseId: string,
    filter: RegistrationListFilter,
    actor: VetCourseActor,
  ): Promise<{ items: VetCourseRegistrationDTO[]; total: number }> {
    const course = await this.courses.getForActor(courseId, actor);
    const { items, total } = await this.registrations.listForCourse(course.id, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  /** The caller's own registrations ("دوراتي"). */
  async listMine(
    actor: VetCourseActor,
    filter: RegistrationListFilter,
  ): Promise<{ items: VetCourseRegistrationDTO[]; total: number }> {
    const { items, total } = await this.registrations.listMine(actor.principal.userId, filter);
    return { items: await Promise.all(items.map((i) => this.toDTO(i))), total };
  }

  async getForActor(id: string, actor: VetCourseActor): Promise<VetCourseRegistrationDTO> {
    const data = await this.registrations.findJoinedById(id);
    if (!data) throw new NotFoundError('Registration not found');
    if (data.registration.registrantUserId === actor.principal.userId) return this.toDTO(data);
    if (data.course && (await this.isCourseOwnerOrModerator(data.course.id, actor))) return this.toDTO(data);
    throw new NotFoundError('Registration not found');
  }

  private async isCourseOwnerOrModerator(courseId: string, actor: VetCourseActor): Promise<boolean> {
    try {
      await this.courses.getForActor(courseId, actor);
      return true;
    } catch {
      return false;
    }
  }

  private async mustGetDTO(id: string): Promise<VetCourseRegistrationDTO> {
    const data = await this.registrations.findJoinedById(id);
    if (!data) throw new NotFoundError('Registration not found');
    return this.toDTO(data);
  }
}
