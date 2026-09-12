import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { VetJobActor } from '../application/vet-job-offer.service.js';
import type { VetJobApplicationService } from '../application/vet-job-application.service.js';
import type { VetJobMedia } from '../application/vet-job-media.js';
import type { VetJobOfferService } from '../application/vet-job-offer.service.js';
import type { VetJobSeekerProfileService } from '../application/vet-job-seeker-profile.service.js';
import type {
  ApplicationListQuery,
  AttachmentUploadUrlBody,
  CreateApplicationBody,
  CreateOfferBody,
  CreateSeekerProfileBody,
  MineQuery,
  OfferBrowseQuery,
  SeekerBrowseQuery,
  UpdateOfferBody,
  UpdateSeekerProfileBody,
} from './vet-job.schemas.js';

function actor(req: Request): VetJobActor {
  return { principal: requireAuth(req), context: auditContextFromRequest(req) };
}

/** POST /vet-jobs/attachments/upload-url — one presign for every vet-jobs attachment (CV/photo). */
export class VetJobAttachmentController {
  constructor(private readonly media: VetJobMedia) {}
  uploadUrl = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<AttachmentUploadUrlBody>(req);
    sendSuccess(res, await this.media.presignUpload(body), StatusCodes.CREATED);
  };
}

export class VetJobOfferController {
  constructor(private readonly offers: VetJobOfferService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateOfferBody>(req);
    sendSuccess(res, await this.offers.create(body, actor(req)), StatusCodes.CREATED);
  };
  listPublic = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<OfferBrowseQuery>(req);
    const { items, total } = await this.offers.listPublic(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<MineQuery>(req);
    const { items, total } = await this.offers.listMine(requireAuth(req).userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getPublic = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.getPublic(id));
  };
  getMine = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.getForActor(id, actor(req)));
  };
  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<UpdateOfferBody>(req);
    sendSuccess(res, await this.offers.update(id, body, actor(req)));
  };
  remove = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    await this.offers.remove(id, actor(req));
    res.status(StatusCodes.NO_CONTENT).send();
  };
  close = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.close(id, actor(req)));
  };
}

export class VetJobSeekerProfileController {
  constructor(private readonly profiles: VetJobSeekerProfileService) {}

  listPublic = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<SeekerBrowseQuery>(req);
    const { items, total } = await this.profiles.listPublic(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getPublic = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.profiles.getPublic(id));
  };
  getMine = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.profiles.getMine(actor(req)));
  };
  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateSeekerProfileBody>(req);
    sendSuccess(res, await this.profiles.createMine(body, actor(req)), StatusCodes.CREATED);
  };
  update = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<UpdateSeekerProfileBody>(req);
    sendSuccess(res, await this.profiles.updateMine(body, actor(req)));
  };
  deactivate = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.profiles.deactivateMine(actor(req)));
  };
}

export class VetJobApplicationController {
  constructor(private readonly applications: VetJobApplicationService) {}

  apply = async (req: Request, res: Response): Promise<void> => {
    const { id: jobOfferId } = validatedParams<{ id: string }>(req);
    const body = validatedBody<CreateApplicationBody>(req);
    sendSuccess(res, await this.applications.apply(jobOfferId, body, actor(req)), StatusCodes.CREATED);
  };
  listForOffer = async (req: Request, res: Response): Promise<void> => {
    const { id: jobOfferId } = validatedParams<{ id: string }>(req);
    const q = validatedQuery<ApplicationListQuery>(req);
    const { items, total } = await this.applications.listForOffer(jobOfferId, q, actor(req));
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listReceived = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ApplicationListQuery>(req);
    const { items, total } = await this.applications.listForPoster(actor(req), q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ApplicationListQuery>(req);
    const { items, total } = await this.applications.listMine(actor(req), q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.applications.getForActor(id, actor(req)));
  };
  accept = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.applications.accept(id, actor(req)));
  };
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.applications.reject(id, actor(req)));
  };
  startConversationWithSeeker = async (req: Request, res: Response): Promise<void> => {
    const { id: seekerProfileId } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.applications.startConversationWithSeeker(seekerProfileId, actor(req)));
  };
}
