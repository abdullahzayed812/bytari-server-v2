import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { EggOfferService } from '../application/egg-offer.service.js';
import { requireEggOffer } from './market.middleware.js';
import type {
  CreateEggOfferBody,
  EggOfferUploadUrlBody,
  ListAdminEggOffersQuery,
  ListEggOffersQuery,
} from './egg-offer.schemas.js';

export class EggOfferController {
  constructor(private readonly offers: EggOfferService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  requestUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<EggOfferUploadUrlBody>(req);
    const result = await this.offers.requestUploadUrl(body);
    sendSuccess(res, result, StatusCodes.CREATED);
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateEggOfferBody>(req);
    const dto = await this.offers.create(body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListEggOffersQuery>(req);
    const { items, total } = await this.offers.list({
      page: q.page,
      pageSize: q.pageSize,
      eggType: q.eggType,
      governorate: q.governorate,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  listMine = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const q = validatedQuery<ListEggOffersQuery>(req);
    const { items, total } = await this.offers.listMine(auth.userId, q.page, q.pageSize);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const offer = requireEggOffer(req);
    sendSuccess(res, await this.offers.get(offer.id));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const offer = requireEggOffer(req);
    await this.offers.remove(offer.id, this.actor(req));
    sendSuccess(res, { success: true });
  };

  adminList = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminEggOffersQuery>(req);
    const { items, total } = await this.offers.adminList({
      page: q.page,
      pageSize: q.pageSize,
      eggType: q.eggType,
      governorate: q.governorate,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  adminRemove = async (req: Request, res: Response): Promise<void> => {
    const offer = requireEggOffer(req);
    await this.offers.remove(offer.id, this.actor(req));
    sendSuccess(res, { success: true });
  };
}
