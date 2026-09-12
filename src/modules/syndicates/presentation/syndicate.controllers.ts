import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { SyndicateActor } from '../application/syndicate.service.js';
import type { SyndicateMedia } from '../application/syndicate-media.js';
import type { SyndicateAnnouncementService } from '../application/syndicate-announcement.service.js';
import type { SyndicateSubmissionService } from '../application/syndicate-submission.service.js';
import type { SyndicateService } from '../application/syndicate.service.js';
import type {
  AnnouncementListQuery,
  CreateAnnouncementBody,
  CreateSubmissionBody,
  CreateSyndicateBody,
  MySubmissionListQuery,
  RespondSubmissionBody,
  SubmissionListQuery,
  SyndicateBrowseQuery,
  UpdateAnnouncementBody,
  UpdateSyndicateProfileBody,
  UploadUrlBody,
} from './syndicate.schemas.js';

function actor(req: Request): SyndicateActor {
  return { principal: requireAuth(req), context: auditContextFromRequest(req) };
}

/** POST /syndicates/media/upload-url — one presign for logo / announcement image / attachment. */
export class SyndicateMediaController {
  constructor(private readonly media: SyndicateMedia) {}
  uploadUrl = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<UploadUrlBody>(req);
    sendSuccess(res, await this.media.presignUpload(body.kind, body), StatusCodes.CREATED);
  };
}

export class SyndicateController {
  constructor(private readonly syndicates: SyndicateService) {}

  listMain = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<SyndicateBrowseQuery>(req);
    const viewerUserId = requireAuth(req).userId;
    const { items, total } = await this.syndicates.listMain(q, viewerUserId);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listBranches = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const q = validatedQuery<SyndicateBrowseQuery>(req);
    const viewerUserId = requireAuth(req).userId;
    const { items, total } = await this.syndicates.listBranches(organizationId, q, viewerUserId);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const viewerUserId = requireAuth(req).userId;
    sendSuccess(res, await this.syndicates.getPublic(organizationId, viewerUserId));
  };
  /** "What can I do here?" — drives whether the mobile app shows management actions. */
  getMyAccess = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    sendSuccess(res, await this.syndicates.getMyAccess(organizationId, requireAuth(req)));
  };
  updateProfile = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<UpdateSyndicateProfileBody>(req);
    sendSuccess(res, await this.syndicates.updateProfile(org.id, body, actor(req)));
  };
}

/** POST /admin/syndicates — ADMIN only. */
export class AdminSyndicateController {
  constructor(private readonly syndicates: SyndicateService) {}
  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateSyndicateBody>(req);
    sendSuccess(res, await this.syndicates.create(body, actor(req)), StatusCodes.CREATED);
  };
}

export class SyndicateAnnouncementController {
  constructor(private readonly announcements: SyndicateAnnouncementService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const q = validatedQuery<AnnouncementListQuery>(req);
    const { items, total } = await this.announcements.listForOrganization(organizationId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.announcements.getOne(id));
  };
  create = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<CreateAnnouncementBody>(req);
    sendSuccess(res, await this.announcements.create(org.id, body, actor(req)), StatusCodes.CREATED);
  };
  update = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<UpdateAnnouncementBody>(req);
    sendSuccess(res, await this.announcements.update(org.id, id, body, actor(req)));
  };
  remove = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { id } = validatedParams<{ id: string }>(req);
    await this.announcements.remove(org.id, id, actor(req));
    res.status(StatusCodes.NO_CONTENT).send();
  };
}

export class SyndicateSubmissionController {
  constructor(private readonly submissions: SyndicateSubmissionService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<CreateSubmissionBody>(req);
    sendSuccess(res, await this.submissions.create(org.id, body, actor(req)), StatusCodes.CREATED);
  };
  listForOrganization = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<SubmissionListQuery>(req);
    const { items, total } = await this.submissions.listForOrganization(org.id, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<MySubmissionListQuery>(req);
    const { items, total } = await this.submissions.listMine(actor(req), q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOwn = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.submissions.getForActor(id, actor(req), false));
  };
  respond = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<RespondSubmissionBody>(req);
    sendSuccess(res, await this.submissions.respond(org.id, id, body.responseText, actor(req)));
  };
  close = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.submissions.close(org.id, id, actor(req)));
  };
  /** Reached only after `authorizeOrg('syndicate.submission.read')` passed — always authorized. */
  getForOrganization = async (req: Request, res: Response): Promise<void> => {
    requireOrganization(req);
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.submissions.getForActor(id, actor(req), true));
  };
}
