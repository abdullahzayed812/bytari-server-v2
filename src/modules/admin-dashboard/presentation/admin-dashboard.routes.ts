import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { ADMIN_DASHBOARD_CARD_IDS } from '../domain/admin-dashboard.types.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';

const cardParamSchema = z.object({ cardId: z.enum(ADMIN_DASHBOARD_CARD_IDS) });

/** Mounts `/admin/dashboard/summary` — the admin dashboard home screen's single aggregate read. */
export function createAdminDashboardRouter(c: Container): Router {
  const ctrl = new AdminDashboardController(c.adminDashboardService);
  const r = Router();

  r.use(c.authenticate);
  r.get('/summary', c.authorization.authorize('dashboard.admin.read'), asyncHandler(ctrl.getSummary));
  r.post(
    '/cards/:cardId/seen',
    c.authorization.authorize('dashboard.admin.read'),
    validate({ params: cardParamSchema }),
    asyncHandler(ctrl.markCardSeen),
  );

  return r;
}
