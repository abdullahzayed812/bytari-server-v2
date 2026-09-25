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

/**
 * `/reports` — any authenticated user may submit a report. Mounted at
 * `/reports`, never path-less: its router-level `authenticate` would otherwise
 * 401 every later public route and every unknown URL (404 → 401).
 */
export function createReportRouter(c: Container): Router {
  const ctrl = new ReportController(c.reportService);
  const r = Router();
  r.use(c.authenticate);
  r.post('/', validate({ body: submitReportBodySchema }), asyncHandler(ctrl.submit));
  return r;
}

/**
 * `/admin/reports/*` — moderation queue (`content_report.admin.manage`).
 *
 * The permission guard is attached PER ROUTE, never via `r.use(...)`: this
 * router is mounted path-less at `/admin` (see `routes/index.ts`), so a
 * router-level `use` would run for EVERY `/admin/*` request that reaches it —
 * including the many admin routers mounted after it (`/admin/animals`,
 * `/admin/content`, `/admin/ads`, `/admin/dashboard`, the support threads, the
 * two stores, …). ADMIN holds every permission and so never noticed, but every
 * non-admin system supervisor was being denied with
 * "Missing required permission: content_report.admin.manage" on routes that
 * have nothing to do with reports.
 */
export function createAdminReportRouter(c: Container): Router {
  const ctrl = new AdminReportController(c.reportService);
  const authorize = c.authorization.authorize('content_report.admin.manage');
  const r = Router();
  r.use(c.authenticate);
  r.get(
    '/reports',
    authorize,
    validate({ query: listReportsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.patch(
    '/reports/:reportId',
    authorize,
    validate({ params: reportIdParamSchema, body: reviewReportBodySchema }),
    asyncHandler(ctrl.review),
  );
  return r;
}
