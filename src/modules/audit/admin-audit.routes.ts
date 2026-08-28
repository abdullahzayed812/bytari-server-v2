import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import type { Container } from '../../container.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { listAuditQuerySchema } from './admin-audit.schemas.js';

/** Mounts `/admin/audit-logs`. */
export function createAdminAuditRouter(c: Container): Router {
  const ctrl = new AdminAuditController(c.auditService);
  const r = Router();

  r.use(c.authenticate);
  r.get(
    '/',
    c.authorization.authorize('audit.read'),
    validate({ query: listAuditQuerySchema }),
    asyncHandler(ctrl.list),
  );

  return r;
}
