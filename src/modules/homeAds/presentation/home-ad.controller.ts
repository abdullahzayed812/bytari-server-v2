import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { HomeAdService } from '../application/home-ad.service.js';
import type {
  CreateHomeAdBody,
  ListAdminHomeAdsQuery,
  RegisterImageBody,
  UpdateHomeAdBody,
  UploadUrlBody,
} from './home-ad.schemas.js';

export class HomeAdController {
  constructor(private readonly homeAds: HomeAdService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- public / user -----------------------------------------

  listPublic = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.homeAds.listPublic());
  };

  // --- admin / supervisor -----------------------------------

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateHomeAdBody>(req);
    sendSuccess(res, await this.homeAds.create(this.actor(req), body), StatusCodes.CREATED);
  };

  listAdmin = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminHomeAdsQuery>(req);
    const { items, total } = await this.homeAds.listAdmin({
      page: q.page,
      pageSize: q.pageSize,
      includeDeleted: q.includeDeleted,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getAdmin = async (req: Request, res: Response): Promise<void> => {
    const { homeAdId } = validatedParams<{ homeAdId: string }>(req);
    sendSuccess(res, await this.homeAds.getAdmin(homeAdId));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { homeAdId } = validatedParams<{ homeAdId: string }>(req);
    const body = validatedBody<UpdateHomeAdBody>(req);
    sendSuccess(res, await this.homeAds.update(this.actor(req), homeAdId, body));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { homeAdId } = validatedParams<{ homeAdId: string }>(req);
    sendSuccess(res, await this.homeAds.setDeleted(this.actor(req), homeAdId, true));
  };

  restore = async (req: Request, res: Response): Promise<void> => {
    const { homeAdId } = validatedParams<{ homeAdId: string }>(req);
    sendSuccess(res, await this.homeAds.setDeleted(this.actor(req), homeAdId, false));
  };

  activate = async (req: Request, res: Response): Promise<void> => {
    const { homeAdId } = validatedParams<{ homeAdId: string }>(req);
    sendSuccess(res, await this.homeAds.setActive(this.actor(req), homeAdId, true));
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const { homeAdId } = validatedParams<{ homeAdId: string }>(req);
    sendSuccess(res, await this.homeAds.setActive(this.actor(req), homeAdId, false));
  };

  requestUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { homeAdId } = validatedParams<{ homeAdId: string }>(req);
    const body = validatedBody<UploadUrlBody>(req);
    sendSuccess(res, await this.homeAds.requestUploadUrl(homeAdId, body), StatusCodes.CREATED);
  };

  registerImage = async (req: Request, res: Response): Promise<void> => {
    const { homeAdId } = validatedParams<{ homeAdId: string }>(req);
    const body = validatedBody<RegisterImageBody>(req);
    sendSuccess(
      res,
      await this.homeAds.registerImage(this.actor(req), homeAdId, body),
      StatusCodes.CREATED,
    );
  };
}
