import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { VetCourseActor } from '../application/vet-course.service.js';
import type { VetCourseRegistrationService } from '../application/vet-course-registration.service.js';
import type { VetCourseService } from '../application/vet-course.service.js';
import type { ModerationQuery, RegistrationListQuery, RejectBody } from './vet-course.schemas.js';

function actor(req: Request): VetCourseActor {
  return { principal: requireAuth(req), context: auditContextFromRequest(req) };
}

/**
 * Moderation of courses / seminars / workshops — `vet_course.read` to view
 * the queue, `vet_course.approve` / `vet_course.reject` to act. All held by
 * ADMIN (override) or an ACTIVE VET_COURSES system-supervisor.
 */
export class AdminVetCourseController {
  constructor(private readonly courses: VetCourseService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ModerationQuery>(req);
    const { items, total } = await this.courses.listForModeration(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.courses.getForModeration(id));
  };
  approve = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.courses.approve(id, actor(req)));
  };
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<RejectBody>(req);
    sendSuccess(res, await this.courses.reject(id, body.reason, actor(req)));
  };
  cancel = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.courses.cancel(id, actor(req)));
  };
}

/** Read-only oversight of registrations ("view registrations") — `vet_course.read`. */
export class AdminVetCourseRegistrationController {
  constructor(private readonly registrations: VetCourseRegistrationService) {}

  listForCourse = async (req: Request, res: Response): Promise<void> => {
    const { id: courseId } = validatedParams<{ id: string }>(req);
    const q = validatedQuery<RegistrationListQuery>(req);
    const { items, total } = await this.registrations.listForCourse(courseId, q, actor(req));
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
}
