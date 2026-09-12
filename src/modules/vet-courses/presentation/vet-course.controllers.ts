import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { VetCourseActor } from '../application/vet-course.service.js';
import type { VetCourseMedia } from '../application/vet-course-media.js';
import type { VetCourseRegistrationService } from '../application/vet-course-registration.service.js';
import type { VetCourseService } from '../application/vet-course.service.js';
import type {
  CourseBrowseQuery,
  CreateCourseBody,
  CreateRegistrationBody,
  ImageUploadUrlBody,
  MineQuery,
  RegistrationListQuery,
  UpdateCourseBody,
} from './vet-course.schemas.js';

function actor(req: Request): VetCourseActor {
  return { principal: requireAuth(req), context: auditContextFromRequest(req) };
}

/** POST /vet-courses/images/upload-url — one presign for every vet-course cover image. */
export class VetCourseImageController {
  constructor(private readonly media: VetCourseMedia) {}
  uploadUrl = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<ImageUploadUrlBody>(req);
    sendSuccess(res, await this.media.presignUpload(body), StatusCodes.CREATED);
  };
}

export class VetCourseController {
  constructor(private readonly courses: VetCourseService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateCourseBody>(req);
    sendSuccess(res, await this.courses.create(body, actor(req)), StatusCodes.CREATED);
  };
  listPublic = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<CourseBrowseQuery>(req);
    const { items, total } = await this.courses.listPublic(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<MineQuery>(req);
    const { items, total } = await this.courses.listMine(requireAuth(req).userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getPublic = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.courses.getPublic(id));
  };
  getMine = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.courses.getForActor(id, actor(req)));
  };
  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<UpdateCourseBody>(req);
    sendSuccess(res, await this.courses.update(id, body, actor(req)));
  };
  remove = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    await this.courses.remove(id, actor(req));
    res.status(StatusCodes.NO_CONTENT).send();
  };
  cancel = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.courses.cancel(id, actor(req)));
  };
}

export class VetCourseRegistrationController {
  constructor(private readonly registrations: VetCourseRegistrationService) {}

  register = async (req: Request, res: Response): Promise<void> => {
    const { id: courseId } = validatedParams<{ id: string }>(req);
    const body = validatedBody<CreateRegistrationBody>(req);
    sendSuccess(res, await this.registrations.register(courseId, body, actor(req)), StatusCodes.CREATED);
  };
  listForCourse = async (req: Request, res: Response): Promise<void> => {
    const { id: courseId } = validatedParams<{ id: string }>(req);
    const q = validatedQuery<RegistrationListQuery>(req);
    const { items, total } = await this.registrations.listForCourse(courseId, q, actor(req));
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<RegistrationListQuery>(req);
    const { items, total } = await this.registrations.listMine(actor(req), q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.registrations.getForActor(id, actor(req)));
  };
}
