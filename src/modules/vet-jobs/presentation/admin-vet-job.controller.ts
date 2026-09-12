import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { VetJobActor } from '../application/vet-job-offer.service.js';
import type { VetJobApplicationService } from '../application/vet-job-application.service.js';
import type { VetJobOfferService } from '../application/vet-job-offer.service.js';
import type { VetJobSeekerProfileService } from '../application/vet-job-seeker-profile.service.js';
import type { ApplicationListQuery, ModerationQuery, RejectBody } from './vet-job.schemas.js';

function actor(req: Request): VetJobActor {
  return { principal: requireAuth(req), context: auditContextFromRequest(req) };
}

/**
 * Moderation of job offers + job-seeker profiles — `vet_job.read` to view the
 * queue, `vet_job.approve` / `vet_job.reject` to act. All held by ADMIN
 * (override) or an ACTIVE VET_JOBS system-supervisor.
 */
export class AdminVetJobOfferController {
  constructor(private readonly offers: VetJobOfferService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ModerationQuery>(req);
    const { items, total } = await this.offers.listForModeration(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.getForModeration(id));
  };
  approve = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.approve(id, actor(req)));
  };
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<RejectBody>(req);
    sendSuccess(res, await this.offers.reject(id, body.reason, actor(req)));
  };
}

export class AdminVetJobSeekerProfileController {
  constructor(private readonly profiles: VetJobSeekerProfileService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ModerationQuery>(req);
    const { items, total } = await this.profiles.listForModeration(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.profiles.getForModeration(id));
  };
  approve = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.profiles.approve(id, actor(req)));
  };
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<RejectBody>(req);
    sendSuccess(res, await this.profiles.reject(id, body.reason, actor(req)));
  };
}

/** Read-only oversight of applications ("View applications") — `vet_job.read`. */
export class AdminVetJobApplicationController {
  constructor(private readonly applications: VetJobApplicationService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ApplicationListQuery>(req);
    const { items, total } = await this.applications.listForModeration(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
}
