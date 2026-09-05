import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { NewsService } from '../application/news.service.js';
import type {
  CreateNewsBody,
  FeaturedBody,
  ImageUploadUrlBody,
  ListAdminNewsQuery,
  ListPublicNewsQuery,
  RegisterImageBody,
  RemoveGalleryImageQuery,
  UpdateNewsBody,
} from './news.schemas.js';

type NewsParams = { newsId: string };

export class NewsController {
  constructor(private readonly news: NewsService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- public ------------------------------------------------

  listPublic = async (req: Request, res: Response): Promise<void> => {
    const userId = requireAuth(req).userId;
    const q = validatedQuery<ListPublicNewsQuery>(req);
    const { items, total } = await this.news.listPublicNews(userId, {
      page: q.page,
      pageSize: q.pageSize,
      search: q.q,
      categoryId: q.categoryId,
      tag: q.tag,
      featured: q.featured,
      bookmarkedByUserId: q.bookmarked ? userId : undefined,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  featured = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.news.getFeatured(requireAuth(req).userId));
  };

  getPublic = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(res, await this.news.getPublicNews(requireAuth(req).userId, newsId));
  };

  bookmark = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(res, await this.news.setBookmark(requireAuth(req).userId, newsId, true));
  };

  unbookmark = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(res, await this.news.setBookmark(requireAuth(req).userId, newsId, false));
  };

  // --- admin / supervisor ---------------------------------

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateNewsBody>(req);
    sendSuccess(res, await this.news.createNews(this.actor(req), body), StatusCodes.CREATED);
  };

  listAdmin = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminNewsQuery>(req);
    const { items, total } = await this.news.listAdminNews({
      page: q.page,
      pageSize: q.pageSize,
      search: q.q,
      categoryId: q.categoryId,
      tag: q.tag,
      status: q.status,
      includeDeleted: q.includeDeleted,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getAdmin = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(res, await this.news.getAdminNews(newsId));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(
      res,
      await this.news.updateNews(this.actor(req), newsId, validatedBody<UpdateNewsBody>(req)),
    );
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(res, await this.news.setDeleted(this.actor(req), newsId, true));
  };

  restore = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(res, await this.news.setDeleted(this.actor(req), newsId, false));
  };

  publish = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(res, await this.news.publishNews(this.actor(req), newsId));
  };

  archive = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(res, await this.news.archiveNews(this.actor(req), newsId));
  };

  setFeatured = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    const { isFeatured } = validatedBody<FeaturedBody>(req);
    sendSuccess(res, await this.news.setFeatured(this.actor(req), newsId, isFeatured));
  };

  requestCoverUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(
      res,
      await this.news.requestCoverUploadUrl(newsId, validatedBody<ImageUploadUrlBody>(req)),
      StatusCodes.CREATED,
    );
  };

  registerCover = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(
      res,
      await this.news.registerCover(this.actor(req), newsId, validatedBody<RegisterImageBody>(req)),
      StatusCodes.CREATED,
    );
  };

  requestGalleryUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(
      res,
      await this.news.requestGalleryUploadUrl(newsId, validatedBody<ImageUploadUrlBody>(req)),
      StatusCodes.CREATED,
    );
  };

  addGalleryImage = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    sendSuccess(
      res,
      await this.news.addGalleryImage(
        this.actor(req),
        newsId,
        validatedBody<RegisterImageBody>(req),
      ),
      StatusCodes.CREATED,
    );
  };

  removeGalleryImage = async (req: Request, res: Response): Promise<void> => {
    const { newsId } = validatedParams<NewsParams>(req);
    const { storageKey } = validatedQuery<RemoveGalleryImageQuery>(req);
    sendSuccess(res, await this.news.removeGalleryImage(this.actor(req), newsId, storageKey));
  };
}
