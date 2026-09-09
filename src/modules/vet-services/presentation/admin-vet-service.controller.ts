import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { VetServiceActor } from '../application/vet-service-listing.service.js';
import type { VetServiceListingService } from '../application/vet-service-listing.service.js';
import type { VetServiceRequestService } from '../application/vet-service-request.service.js';
import type { ModerationQuery, RejectBody } from './vet-service.schemas.js';

function actor(req: Request): VetServiceActor {
  return { principal: requireAuth(req), context: auditContextFromRequest(req) };
}

/**
 * Moderation of vet-service listings + pet-owner requests — `vet_service.read`
 * to view the queue, `vet_service.approve` / `vet_service.reject` to act. All
 * held by ADMIN (override) or an ACTIVE VET_SERVICE system-supervisor.
 */
export class AdminVetServiceListingController {
  constructor(private readonly listings: VetServiceListingService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ModerationQuery>(req);
    const { items, total } = await this.listings.listForModeration(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listings.getForModeration(id));
  };
  approve = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listings.approve(id, actor(req)));
  };
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<RejectBody>(req);
    sendSuccess(res, await this.listings.reject(id, body.reason, actor(req)));
  };
}

export class AdminVetServiceRequestController {
  constructor(private readonly requests: VetServiceRequestService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ModerationQuery>(req);
    const { items, total } = await this.requests.listForModeration(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.requests.getForModeration(id));
  };
  approve = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.requests.approve(id, actor(req)));
  };
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<RejectBody>(req);
    sendSuccess(res, await this.requests.reject(id, body.reason, actor(req)));
  };
}
