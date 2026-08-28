import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../shared/http/pagination.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../shared/http/validate.js';
import { auditContextFromRequest } from '../audit/audit-context.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import type { SupervisorService } from './supervisor.service.js';
import type { AssignSupervisorBody, ListSupervisorsQuery } from './supervisor.schemas.js';

export class SupervisorController {
  constructor(private readonly supervisors: SupervisorService) {}

  private actor(req: Request): {
    actorUserId: string;
    context: ReturnType<typeof auditContextFromRequest>;
  } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListSupervisorsQuery>(req);
    const { items, total } = await this.supervisors.list({
      page: q.page,
      pageSize: q.pageSize,
      domain: q.domain,
      userId: q.userId,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  assign = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<AssignSupervisorBody>(req);
    const assignment = await this.supervisors.assign(body.userId, body.domain, this.actor(req));
    sendSuccess(res, assignment, StatusCodes.CREATED);
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const assignment = await this.supervisors.remove(id, this.actor(req));
    sendSuccess(res, assignment);
  };
}
