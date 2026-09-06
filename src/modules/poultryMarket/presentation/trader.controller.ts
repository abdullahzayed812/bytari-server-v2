import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { TraderService } from '../application/trader.service.js';
import type {
  ListTradersQuery,
  RegisterTraderBody,
  RejectTraderBody,
  SuspendTraderBody,
} from './trader.schemas.js';

export class TraderController {
  constructor(private readonly traders: TraderService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  register = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<RegisterTraderBody>(req);
    const profile = await this.traders.register(
      auth.userId,
      {
        displayName: body.displayName,
        traderType: body.traderType,
        governorate: body.governorate,
        district: body.district,
        phone: body.phone,
        whatsapp: body.whatsapp,
        bio: body.bio,
      },
      auditContextFromRequest(req),
    );
    sendSuccess(res, profile, StatusCodes.CREATED);
  };

  myStatus = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    sendSuccess(res, await this.traders.getStatus(auth.userId));
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListTradersQuery>(req);
    const { items, total } = await this.traders.list(q.status, q.page, q.pageSize);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { userId } = validatedParams<{ userId: string }>(req);
    sendSuccess(res, await this.traders.getOne(userId));
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    const { userId } = validatedParams<{ userId: string }>(req);
    sendSuccess(res, await this.traders.approve(userId, this.actor(req)));
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    const { userId } = validatedParams<{ userId: string }>(req);
    const { reason } = validatedBody<RejectTraderBody>(req);
    sendSuccess(res, await this.traders.reject(userId, reason, this.actor(req)));
  };

  suspend = async (req: Request, res: Response): Promise<void> => {
    const { userId } = validatedParams<{ userId: string }>(req);
    const { reason } = validatedBody<SuspendTraderBody>(req);
    sendSuccess(res, await this.traders.suspend(userId, reason ?? null, this.actor(req)));
  };

  reactivate = async (req: Request, res: Response): Promise<void> => {
    const { userId } = validatedParams<{ userId: string }>(req);
    sendSuccess(res, await this.traders.reactivate(userId, this.actor(req)));
  };
}
