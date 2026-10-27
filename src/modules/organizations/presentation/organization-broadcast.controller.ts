import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta, type PaginationQuery } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { OrganizationBroadcastService } from '../application/organization-broadcast.service.js';
import type { OrganizationEngagementService } from '../application/organization-engagement.service.js';
import { requireOrganization } from './organization.middleware.js';
import type {
  OrganizationBroadcastImageUploadUrlBody,
  SendOrganizationBroadcastBody,
} from './organization-broadcast.schemas.js';

export class OrganizationBroadcastController {
  constructor(
    private readonly broadcasts: OrganizationBroadcastService,
    private readonly engagement: OrganizationEngagementService,
  ) {}

  /** `GET /organizations/:id/followers` — the dashboard Followers page (names only). */
  listFollowers = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<PaginationQuery>(req);
    const { items, total } = await this.engagement.listFollowers(org.id, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  requestImageUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<OrganizationBroadcastImageUploadUrlBody>(req);
    sendSuccess(res, await this.broadcasts.requestImageUploadUrl(org.id, body));
  };

  send = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { audience, ...body } = validatedBody<SendOrganizationBroadcastBody>(req);
    sendSuccess(
      res,
      await this.broadcasts.send(org.id, body, this.actor(req), { audience }),
      StatusCodes.CREATED,
    );
  };
}
