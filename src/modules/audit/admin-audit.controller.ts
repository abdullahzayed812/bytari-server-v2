import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../shared/http/pagination.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedQuery } from '../../shared/http/validate.js';
import type { AuditService } from './audit.service.js';
import type { ListAuditQuery } from './admin-audit.schemas.js';

export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAuditQuery>(req);
    const { items, total } = await this.audit.list({
      page: q.page,
      pageSize: q.pageSize,
      action: q.action,
      entityType: q.entityType,
      entityId: q.entityId,
      actorUserId: q.actorUserId,
      from: q.from,
      to: q.to,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
}
