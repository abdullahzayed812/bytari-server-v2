import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { TipService } from '../application/tip.service.js';
import type {
  CoverUploadUrlBody,
  CreateTipBody,
  ListAdminTipsQuery,
  ListPublicTipsQuery,
  RegisterCoverBody,
  TipOfDayBody,
  UpdateTipBody,
} from './tip.schemas.js';

type TipParams = { tipId: string };

export class TipController {
  constructor(private readonly tips: TipService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- public ------------------------------------------------

  listPublic = async (req: Request, res: Response): Promise<void> => {
    const userId = requireAuth(req).userId;
    const q = validatedQuery<ListPublicTipsQuery>(req);
    const { items, total } = await this.tips.listPublicTips(userId, {
      page: q.page,
      pageSize: q.pageSize,
      search: q.q,
      categoryId: q.categoryId,
      priority: q.priority,
      bookmarkedByUserId: q.bookmarked ? userId : undefined,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  tipOfTheDay = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.tips.getTipOfTheDay(requireAuth(req).userId));
  };

  getPublic = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.getPublicTip(requireAuth(req).userId, tipId));
  };

  bookmark = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.setBookmark(requireAuth(req).userId, tipId, true));
  };

  unbookmark = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.setBookmark(requireAuth(req).userId, tipId, false));
  };

  markHelpful = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.setHelpful(requireAuth(req).userId, tipId, true));
  };

  unmarkHelpful = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.setHelpful(requireAuth(req).userId, tipId, false));
  };

  // --- admin / supervisor ---------------------------------

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateTipBody>(req);
    sendSuccess(res, await this.tips.createTip(this.actor(req), body), StatusCodes.CREATED);
  };

  listAdmin = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminTipsQuery>(req);
    const { items, total } = await this.tips.listAdminTips({
      page: q.page,
      pageSize: q.pageSize,
      search: q.q,
      categoryId: q.categoryId,
      priority: q.priority,
      status: q.status,
      includeDeleted: q.includeDeleted,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getAdmin = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.getAdminTip(tipId));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(
      res,
      await this.tips.updateTip(this.actor(req), tipId, validatedBody<UpdateTipBody>(req)),
    );
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.setDeleted(this.actor(req), tipId, true));
  };

  restore = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.setDeleted(this.actor(req), tipId, false));
  };

  publish = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.publishTip(this.actor(req), tipId));
  };

  archive = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(res, await this.tips.archiveTip(this.actor(req), tipId));
  };

  setTipOfDay = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    const { isTipOfDay } = validatedBody<TipOfDayBody>(req);
    sendSuccess(res, await this.tips.setTipOfDay(this.actor(req), tipId, isTipOfDay));
  };

  requestCoverUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(
      res,
      await this.tips.requestCoverUploadUrl(tipId, validatedBody<CoverUploadUrlBody>(req)),
      StatusCodes.CREATED,
    );
  };

  registerCover = async (req: Request, res: Response): Promise<void> => {
    const { tipId } = validatedParams<TipParams>(req);
    sendSuccess(
      res,
      await this.tips.registerCover(this.actor(req), tipId, validatedBody<RegisterCoverBody>(req)),
      StatusCodes.CREATED,
    );
  };
}
