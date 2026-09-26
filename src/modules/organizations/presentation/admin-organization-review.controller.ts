import type { Request, Response } from 'express';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { OrganizationEngagementService } from '../application/organization-engagement.service.js';
import type { AdminDeleteReviewBody, AdminListReviewsQuery } from './organization.schemas.js';

/** `/admin/organizations/reviews*` — moderation of clinic / office / store reviews. */
export class AdminOrganizationReviewController {
  constructor(private readonly engagement: OrganizationEngagementService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<AdminListReviewsQuery>(req);
    const { items, total } = await this.engagement.listReviewsForModeration({
      page: q.page,
      pageSize: q.pageSize,
      organizationId: q.organizationId,
      organizationType: q.type,
      maxRating: q.maxRating,
    });
    sendSuccess(res, items, 200, pageMeta(q.page, q.pageSize, total));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<AdminDeleteReviewBody>(req);
    await this.engagement.deleteReviewAsAdmin(
      id,
      { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) },
      body.reason ?? null,
    );
    sendSuccess(res, { success: true });
  };
}
