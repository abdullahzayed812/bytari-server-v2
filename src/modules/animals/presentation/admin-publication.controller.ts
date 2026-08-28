import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AnimalPublicationService } from '../application/animal-publication.service.js';
import type { ModerationPublicationsQuery, RejectPublicationBody } from './publication.schemas.js';

/** Moderation of Lost / Adoption / Mating publications (ADMIN or ANIMAL supervisor). */
export class AdminPublicationController {
  constructor(private readonly publications: AnimalPublicationService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ModerationPublicationsQuery>(req);
    const { items, total } = await this.publications.listForModeration({
      page: q.page,
      pageSize: q.pageSize,
      kind: q.kind,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { publicationId } = validatedParams<{ publicationId: string }>(req);
    sendSuccess(res, await this.publications.getForModeration(publicationId));
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    const { publicationId } = validatedParams<{ publicationId: string }>(req);
    sendSuccess(res, await this.publications.approve(publicationId, this.actor(req)));
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    const { publicationId } = validatedParams<{ publicationId: string }>(req);
    const body = validatedBody<RejectPublicationBody>(req);
    sendSuccess(res, await this.publications.reject(publicationId, body.reason, this.actor(req)));
  };
}
