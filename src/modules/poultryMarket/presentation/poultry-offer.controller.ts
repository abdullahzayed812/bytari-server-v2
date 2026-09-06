import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { PoultryOfferService } from '../application/poultry-offer.service.js';
import { requirePoultryOffer } from './market.middleware.js';
import type {
  CreatePoultryOfferBody,
  ListAdminPoultryOffersQuery,
  ListPoultryOffersQuery,
  PoultryOfferUploadUrlBody,
} from './poultry-offer.schemas.js';

export class PoultryOfferController {
  constructor(private readonly offers: PoultryOfferService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  requestUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<PoultryOfferUploadUrlBody>(req);
    const result = await this.offers.requestUploadUrl(body);
    sendSuccess(res, result, StatusCodes.CREATED);
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreatePoultryOfferBody>(req);
    const dto = await this.offers.create(body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListPoultryOffersQuery>(req);
    const { items, total } = await this.offers.list({
      page: q.page,
      pageSize: q.pageSize,
      birdType: q.birdType,
      governorate: q.governorate,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  listMine = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const q = validatedQuery<ListPoultryOffersQuery>(req);
    const { items, total } = await this.offers.listMine(auth.userId, q.page, q.pageSize);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const offer = requirePoultryOffer(req);
    sendSuccess(res, await this.offers.get(offer.id));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const offer = requirePoultryOffer(req);
    await this.offers.remove(offer.id, this.actor(req));
    sendSuccess(res, { success: true });
  };

  adminList = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminPoultryOffersQuery>(req);
    const { items, total } = await this.offers.adminList({
      page: q.page,
      pageSize: q.pageSize,
      birdType: q.birdType,
      governorate: q.governorate,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  adminRemove = async (req: Request, res: Response): Promise<void> => {
    const offer = requirePoultryOffer(req);
    await this.offers.remove(offer.id, this.actor(req));
    sendSuccess(res, { success: true });
  };
}
