import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedBody, validatedParams } from '../../shared/http/validate.js';
import { auditContextFromRequest } from '../audit/audit-context.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import type { RbacService } from './rbac.service.js';
import type { AddPermissionBody } from './admin-rbac.schemas.js';

export class AdminRbacController {
  constructor(private readonly rbac: RbacService) {}

  private actor(req: Request): {
    actorUserId: string;
    context: ReturnType<typeof auditContextFromRequest>;
  } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  listRoles = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.rbac.listRolesWithPermissions());
  };

  getRole = async (req: Request, res: Response): Promise<void> => {
    const { key } = validatedParams<{ key: string }>(req);
    sendSuccess(res, await this.rbac.getRoleWithPermissions(key));
  };

  listPermissions = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.rbac.listPermissions());
  };

  addPermission = async (req: Request, res: Response): Promise<void> => {
    const { key } = validatedParams<{ key: string }>(req);
    const { permissionKey } = validatedBody<AddPermissionBody>(req);
    await this.rbac.addPermissionToRole(key, permissionKey, this.actor(req));
    sendSuccess(res, await this.rbac.getRoleWithPermissions(key));
  };

  removePermission = async (req: Request, res: Response): Promise<void> => {
    const { key, permissionKey } = validatedParams<{ key: string; permissionKey: string }>(req);
    await this.rbac.removePermissionFromRole(key, permissionKey, this.actor(req));
    sendSuccess(res, await this.rbac.getRoleWithPermissions(key));
  };
}
