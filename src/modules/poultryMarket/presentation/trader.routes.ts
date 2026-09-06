import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import { userIdParamSchema } from '../../../shared/validation/common.js';
import type { Container } from '../../../container.js';
import { TraderController } from './trader.controller.js';
import {
  listTradersQuerySchema,
  registerTraderBodySchema,
  rejectTraderBodySchema,
  suspendTraderBodySchema,
} from './trader.schemas.js';

/**
 * `self`  → `/traders/*`        (authenticated users)
 * `admin` → `/admin/traders/*`  (permission-guarded)
 */
export function createTraderRouters(c: Container): { self: Router; admin: Router } {
  const ctrl = new TraderController(c.traderService);
  const { authorize } = c.authorization;

  const self = Router();
  self.use(c.authenticate);
  self.post(
    '/register',
    validate({ body: registerTraderBodySchema }),
    asyncHandler(ctrl.register),
  );
  self.get('/me', asyncHandler(ctrl.myStatus));

  const admin = Router();
  admin.use(c.authenticate);
  admin.get(
    '/',
    authorize('trader.admin.read'),
    validate({ query: listTradersQuerySchema }),
    asyncHandler(ctrl.list),
  );
  admin.get(
    '/:userId',
    authorize('trader.admin.read'),
    validate({ params: userIdParamSchema }),
    asyncHandler(ctrl.getOne),
  );
  admin.post(
    '/:userId/approve',
    authorize('trader.admin.approve'),
    validate({ params: userIdParamSchema }),
    asyncHandler(ctrl.approve),
  );
  admin.post(
    '/:userId/reject',
    authorize('trader.admin.reject'),
    validate({ params: userIdParamSchema, body: rejectTraderBodySchema }),
    asyncHandler(ctrl.reject),
  );
  admin.post(
    '/:userId/suspend',
    authorize('trader.admin.suspend'),
    validate({ params: userIdParamSchema, body: suspendTraderBodySchema }),
    asyncHandler(ctrl.suspend),
  );
  admin.post(
    '/:userId/reactivate',
    authorize('trader.admin.suspend'),
    validate({ params: userIdParamSchema }),
    asyncHandler(ctrl.reactivate),
  );

  return { self, admin };
}
