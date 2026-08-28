import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import { idParamSchema } from '../../shared/validation/common.js';
import type { Container } from '../../container.js';
import { AdminUsersController } from './admin-users.controller.js';
import {
  assignRoleBodySchema,
  createUserBodySchema,
  listUsersQuerySchema,
  roleKeyParamSchema,
  statusChangeBodySchema,
  updateUserBodySchema,
} from './admin-users.schemas.js';

/** Mounts `/admin/users/*`. Every route requires authentication + a permission. */
export function createAdminUsersRouter(c: Container): Router {
  const ctrl = new AdminUsersController(c.userService, c.rbacService, c.authService);
  const { authorize } = c.authorization;
  const r = Router();

  r.use(c.authenticate);

  r.get(
    '/',
    authorize('user.read'),
    validate({ query: listUsersQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.post(
    '/',
    authorize('user.create'),
    validate({ body: createUserBodySchema }),
    asyncHandler(ctrl.create),
  );
  r.get(
    '/:id',
    authorize('user.read'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.get),
  );
  r.patch(
    '/:id',
    authorize('user.update'),
    validate({ params: idParamSchema, body: updateUserBodySchema }),
    asyncHandler(ctrl.update),
  );
  r.post(
    '/:id/suspend',
    authorize('user.suspend'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.suspend),
  );
  r.post(
    '/:id/activate',
    authorize('user.activate'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.activate),
  );
  r.post(
    '/:id/deactivate',
    authorize('user.deactivate'),
    validate({ params: idParamSchema, body: statusChangeBodySchema }),
    asyncHandler(ctrl.deactivate),
  );
  r.post(
    '/:id/roles',
    authorize('role.assign'),
    validate({ params: idParamSchema, body: assignRoleBodySchema }),
    asyncHandler(ctrl.assignRole),
  );
  r.delete(
    '/:id/roles/:roleKey',
    authorize('role.assign'),
    validate({ params: roleKeyParamSchema }),
    asyncHandler(ctrl.removeRole),
  );

  return r;
}
