import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import {
  applyFinancialVisibility,
  canSeeFarmFinancials,
  stripFinancialInput,
} from './farm-financials.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { PoultryFlockService } from '../application/poultry-flock.service.js';
import { requirePoultryFlock } from './poultry-flock.middleware.js';
import type {
  CreatePoultryFlockBody,
  ListPoultryFlocksQuery,
  UpdatePoultryFlockBody,
} from './poultry-flock.schemas.js';

/** Poultry flock HTTP adapter. No business logic. */
export class PoultryController {
  constructor(
    private readonly flocks: PoultryFlockService,
    private readonly authz: AuthorizationService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  createFlock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const visible = await canSeeFarmFinancials(this.authz, req, org.id);
    const body = validatedBody<CreatePoultryFlockBody>(req);
    const dto = await this.flocks.create({ id: org.id, type: org.type }, stripFinancialInput(body, visible), this.actor(req));
    sendSuccess(res, applyFinancialVisibility(dto, visible), StatusCodes.CREATED);
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
    const visible = await canSeeFarmFinancials(this.authz, req, org.id);
    sendSuccess(res, items.map((i) => applyFinancialVisibility(i, visible)), StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getFlock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const flock = requirePoultryFlock(req);
    const visible = await canSeeFarmFinancials(this.authz, req, org.id);
    sendSuccess(res, applyFinancialVisibility(await this.flocks.get(org.id, flock.id), visible));
  };

  updateFlock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const flock = requirePoultryFlock(req);
    const body = validatedBody<UpdatePoultryFlockBody>(req);
    const visible = await canSeeFarmFinancials(this.authz, req, org.id);
    const dto = await this.flocks.update(org.id, flock.id, stripFinancialInput(body, visible), this.actor(req));
    sendSuccess(res, applyFinancialVisibility(dto, visible));
  };

  deleteFlock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const flock = requirePoultryFlock(req);
    await this.flocks.delete(org.id, flock.id, this.actor(req));
    sendSuccess(res, { deleted: true });
  };
}
