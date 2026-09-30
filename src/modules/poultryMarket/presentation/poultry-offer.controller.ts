import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { TraderRepository } from '../infrastructure/trader.repository.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { PoultryOfferService } from '../application/poultry-offer.service.js';
import { requirePoultryOffer } from './market.middleware.js';
import type {
  RejectPoultryOfferBody,
  CreatePoultryOfferBody,
  ListAdminPoultryOffersQuery,
  ListPoultryOffersQuery,
  PoultryOfferUploadUrlBody,
} from './poultry-offer.schemas.js';

export class PoultryOfferController {
  constructor(
    private readonly offers: PoultryOfferService,
    private readonly authz: AuthorizationService,
    private readonly traders: TraderRepository,
  ) {}

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

  /** A not-yet-approved (or rejected) ad is visible only to its trader and to moderators. */
  getOne = async (req: Request, res: Response): Promise<void> => {
    const offer = requirePoultryOffer(req);
    const dto = await this.offers.get(offer.id);
    if (dto.moderationStatus !== 'APPROVED') {
      const principal = requireAuth(req);
      const allowed =
        dto.traderUserId === principal.userId ||
        (await this.authz.can(principal, 'market.offer.admin.read'));
      if (!allowed) throw new NotFoundError('Offer not found');
    }
    sendSuccess(res, dto);
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    const offer = requirePoultryOffer(req);
    sendSuccess(res, await this.offers.moderate(offer.id, 'APPROVED', null, this.actor(req)));
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    const offer = requirePoultryOffer(req);
    const body = validatedBody<RejectPoultryOfferBody>(req);
    sendSuccess(
      res,
      await this.offers.moderate(offer.id, 'REJECTED', body.reason, this.actor(req)),
    );
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
      moderationStatus: q.moderationStatus,
    });
    // The reviewer needs to see WHO is selling (admin-only, `market.offer.admin.read`).
    const sellers = await this.traders.findSellerSummaries(items.map((o) => o.traderUserId));
    const withSeller = items.map((o) => ({ ...o, seller: sellers.get(o.traderUserId) ?? null }));
    sendSuccess(res, withSeller, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  adminRemove = async (req: Request, res: Response): Promise<void> => {
    const offer = requirePoultryOffer(req);
    await this.offers.remove(offer.id, this.actor(req));
    sendSuccess(res, { success: true });
  };
}
