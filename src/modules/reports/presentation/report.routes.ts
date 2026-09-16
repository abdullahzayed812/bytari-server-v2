import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { AdminReportController, ReportController } from './report.controller.js';
import {
  listReportsQuerySchema,
  reportIdParamSchema,
  reviewReportBodySchema,
  submitReportBodySchema,
} from './report.schemas.js';

/** `/reports` — any authenticated user may submit a report. */
export function createReportRouter(c: Container): Router {
  const ctrl = new ReportController(c.reportService);
  const r = Router();
  r.use(c.authenticate);
  r.post('/reports', validate({ body: submitReportBodySchema }), asyncHandler(ctrl.submit));
  return r;
}

/** `/admin/reports/*` — moderation queue (`content_report.admin.manage`). */
export function createAdminReportRouter(c: Container): Router {
  const ctrl = new AdminReportController(c.reportService);
  const r = Router();
  r.use(c.authenticate);
  r.use(c.authorization.authorize('content_report.admin.manage'));
  r.get('/reports', validate({ query: listReportsQuerySchema }), asyncHandler(ctrl.list));
  r.patch(
    '/reports/:reportId',
    validate({ params: reportIdParamSchema, body: reviewReportBodySchema }),
    asyncHandler(ctrl.review),
  );
  return r;
}
