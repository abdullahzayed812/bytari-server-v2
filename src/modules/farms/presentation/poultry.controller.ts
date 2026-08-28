import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { PoultryFlockService } from '../application/poultry-flock.service.js';
import { requirePoultryFlock } from './farm.middleware.js';
import type {
  CreatePoultryFlockBody,
  ListPoultryFlocksQuery,
  UpdatePoultryFlockBody,
} from './farm.schemas.js';

/** Poultry flock HTTP adapter. No business logic. */
export class PoultryController {
  constructor(private readonly flocks: PoultryFlockService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  createFlock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<CreatePoultryFlockBody>(req);
    const dto = await this.flocks.create({ id: org.id, type: org.type }, body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  listFlocks = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListPoultryFlocksQuery>(req);
    const { items, total } = await this.flocks.list(org.id, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      birdType: q.birdType,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getFlock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const flock = requirePoultryFlock(req);
    sendSuccess(res, await this.flocks.get(org.id, flock.id));
  };

  updateFlock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const flock = requirePoultryFlock(req);
    const body = validatedBody<UpdatePoultryFlockBody>(req);
    sendSuccess(res, await this.flocks.update(org.id, flock.id, body, this.actor(req)));
  };

  deleteFlock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const flock = requirePoultryFlock(req);
    await this.flocks.delete(org.id, flock.id, this.actor(req));
    sendSuccess(res, { deleted: true });
  };
}
