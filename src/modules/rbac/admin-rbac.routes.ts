import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import type { Container } from '../../container.js';
import { AdminRbacController } from './admin-rbac.controller.js';
import {
  addPermissionBodySchema,
  roleKeyParamSchema,
  rolePermissionParamSchema,
} from './admin-rbac.schemas.js';

/** Mounts `/admin/roles/*` and `/admin/permissions`. */
export function createAdminRbacRouter(c: Container): { roles: Router; permissions: Router } {
  const ctrl = new AdminRbacController(c.rbacService);
  const { authorize } = c.authorization;

  const roles = Router();
  roles.use(c.authenticate);
  roles.get('/', authorize('role.read'), asyncHandler(ctrl.listRoles));
  roles.get(
    '/:key',
    authorize('role.read'),
    validate({ params: roleKeyParamSchema }),
    asyncHandler(ctrl.getRole),
  );
  roles.post(
    '/:key/permissions',
    authorize('permission.assign'),
    validate({ params: roleKeyParamSchema, body: addPermissionBodySchema }),
    asyncHandler(ctrl.addPermission),
  );
  roles.delete(
    '/:key/permissions/:permissionKey',
    authorize('permission.assign'),
    validate({ params: rolePermissionParamSchema }),
    asyncHandler(ctrl.removePermission),
  );

  const permissions = Router();
  permissions.use(c.authenticate);
  permissions.get('/', authorize('permission.read'), asyncHandler(ctrl.listPermissions));

  return { roles, permissions };
}
