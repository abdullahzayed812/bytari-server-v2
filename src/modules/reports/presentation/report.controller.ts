import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { ReportService } from '../application/report.service.js';
import type {
  ListReportsQuery,
  ReviewReportBody,
  SubmitReportBody,
} from './report.schemas.js';

/** `POST /reports` — any authenticated user reports a message or a room. */
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  submit = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const body = validatedBody<SubmitReportBody>(req);
    const report = await this.reports.submit(body, {
      actorUserId: userId,
      context: auditContextFromRequest(req),
    });
    sendSuccess(res, report, StatusCodes.CREATED);
  };
}

/** `/admin/reports/*` — moderation queue (`content_report.admin.manage`). */
export class AdminReportController {
  constructor(private readonly reports: ReportService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListReportsQuery>(req);
    const { items, total } = await this.reports.listForAdmin({
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      targetType: q.targetType,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  review = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { reportId } = validatedParams<{ reportId: string }>(req);
    const body = validatedBody<ReviewReportBody>(req);
    const report = await this.reports.review(reportId, body.status, {
      actorUserId: userId,
      context: auditContextFromRequest(req),
    });
    sendSuccess(res, report);
  };
}
