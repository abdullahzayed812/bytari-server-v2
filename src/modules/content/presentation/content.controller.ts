import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { ContentService } from '../application/content.service.js';
import type {
  AddCommentBody,
  CreateContentBody,
  ListAdminContentQuery,
  ListCommentsQuery,
  ListPublicContentQuery,
  RegisterFileBody,
  SubmitRatingBody,
  UpdateContentBody,
  UploadUrlBody,
} from './content.schemas.js';

export class ContentController {
  constructor(private readonly content: ContentService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- public / user -----------------------------------------

  listPublic = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListPublicContentQuery>(req);
    const { items, total } = await this.content.listPublic({
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
      categoryId: q.categoryId,
      search: q.q,
      sort: q.sort,
      bookmarkedOnly: q.bookmarkedOnly,
      viewerId: requireAuth(req).userId,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getPublic = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.getPublic(contentId, requireAuth(req).userId));
  };

  downloadPublic = async (req: Request, res: Response): Promise<void> => {
    const { contentId, fileId } = validatedParams<{ contentId: string; fileId: string }>(req);
    sendSuccess(
      res,
      await this.content.fileDownloadUrl(contentId, fileId, { requirePublished: true }),
    );
  };

  // --- engagement: bookmarks / likes -------------------------

  bookmark = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    await this.content.setBookmark(requireAuth(req).userId, contentId, true);
    sendSuccess(res, { isBookmarked: true });
  };

  unbookmark = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    await this.content.setBookmark(requireAuth(req).userId, contentId, false);
    sendSuccess(res, { isBookmarked: false });
  };

  like = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.setLike(requireAuth(req).userId, contentId, true));
  };

  unlike = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.setLike(requireAuth(req).userId, contentId, false));
  };

  // --- engagement: comments -----------------------------------

  listComments = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    const q = validatedQuery<ListCommentsQuery>(req);
    const { items, total } = await this.content.listComments(contentId, q.page, q.pageSize);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  addComment = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    const { body } = validatedBody<AddCommentBody>(req);
    sendSuccess(
      res,
      await this.content.addComment(requireAuth(req).userId, contentId, body),
      StatusCodes.CREATED,
    );
  };

  deleteComment = async (req: Request, res: Response): Promise<void> => {
    const { contentId, commentId } = validatedParams<{ contentId: string; commentId: string }>(req);
    await this.content.deleteComment(requireAuth(req).userId, contentId, commentId);
    sendSuccess(res, { deleted: true });
  };

  // --- engagement: rating (books) -----------------------------

  getRating = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.getRating(contentId, requireAuth(req).userId));
  };

  submitRating = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    const { rating } = validatedBody<SubmitRatingBody>(req);
    sendSuccess(res, await this.content.submitRating(requireAuth(req).userId, contentId, rating));
  };

  // --- admin / supervisor -----------------------------------

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateContentBody>(req);
    sendSuccess(res, await this.content.create(this.actor(req), body), StatusCodes.CREATED);
  };

  listAdmin = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminContentQuery>(req);
    const { items, total } = await this.content.listAdmin({
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
      status: q.status,
      categoryId: q.categoryId,
      search: q.q,
      includeDeleted: q.includeDeleted,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getAdmin = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.getAdmin(contentId));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    const body = validatedBody<UpdateContentBody>(req);
    sendSuccess(res, await this.content.update(this.actor(req), contentId, body));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.setDeleted(this.actor(req), contentId, true));
  };

  restore = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.setDeleted(this.actor(req), contentId, false));
  };

  publish = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.publish(this.actor(req), contentId));
  };

  archive = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    sendSuccess(res, await this.content.archive(this.actor(req), contentId));
  };

  requestUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    const body = validatedBody<UploadUrlBody>(req);
    sendSuccess(res, await this.content.requestUploadUrl(contentId, body), StatusCodes.CREATED);
  };

  registerFile = async (req: Request, res: Response): Promise<void> => {
    const { contentId } = validatedParams<{ contentId: string }>(req);
    const body = validatedBody<RegisterFileBody>(req);
    sendSuccess(
      res,
      await this.content.registerFile(this.actor(req), contentId, body),
      StatusCodes.CREATED,
    );
  };

  deleteFile = async (req: Request, res: Response): Promise<void> => {
    const { contentId, fileId } = validatedParams<{ contentId: string; fileId: string }>(req);
    sendSuccess(res, await this.content.deleteFile(this.actor(req), contentId, fileId));
  };

  downloadAdmin = async (req: Request, res: Response): Promise<void> => {
    const { contentId, fileId } = validatedParams<{ contentId: string; fileId: string }>(req);
    sendSuccess(
      res,
      await this.content.fileDownloadUrl(contentId, fileId, { requirePublished: false }),
    );
  };
}
