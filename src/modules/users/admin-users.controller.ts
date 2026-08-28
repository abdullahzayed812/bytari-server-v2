import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { pageMeta } from '../../shared/http/pagination.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../audit/audit-context.js';
import type { AuthService } from '../auth/auth.service.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import type { RbacService } from '../rbac/rbac.service.js';
import { toPublicUser } from './user.mapper.js';
import type { UserService } from './user.service.js';
import type {
  AssignRoleBody,
  CreateUserBody,
  ListUsersQuery,
  StatusChangeBody,
  UpdateUserBody,
} from './admin-users.schemas.js';

/** Admin account-management endpoints. Authorization is enforced by route guards. */
export class AdminUsersController {
  constructor(
    private readonly users: UserService,
    private readonly rbac: RbacService,
    private readonly auth: AuthService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListUsersQuery>(req);
    const { items, total } = await this.users.list({
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      veterinarianStatus: q.veterinarianStatus,
      search: q.search,
    });
    sendSuccess(res, items.map(toPublicUser), StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const user = await this.users.getById(id);
    const roles = await this.rbac.getRoleKeysForUser(id);
    sendSuccess(res, { ...toPublicUser(user), roles });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateUserBody>(req);
    const { user, roleKeys } = await this.auth.adminCreateUser(
      {
        email: body.email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone ?? null,
        roles: body.roles,
      },
      this.actor(req),
    );
    sendSuccess(res, { ...user, roles: roleKeys }, StatusCodes.CREATED);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<UpdateUserBody>(req);
    const user = await this.users.updateProfile(id, body, this.actor(req));
    sendSuccess(res, toPublicUser(user));
  };

  suspend = (req: Request, res: Response): Promise<void> =>
    this.changeStatus(req, res, 'SUSPENDED');
  activate = (req: Request, res: Response): Promise<void> => this.changeStatus(req, res, 'ACTIVE');
  deactivate = (req: Request, res: Response): Promise<void> =>
    this.changeStatus(req, res, 'DEACTIVATED');

  assignRole = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const { roleKey } = validatedBody<AssignRoleBody>(req);
    await this.ensureUserExists(id);
    await this.rbac.assignRoleToUser(id, roleKey, this.actor(req));
    sendSuccess(res, { userId: id, roles: await this.rbac.getRoleKeysForUser(id) });
  };

  removeRole = async (req: Request, res: Response): Promise<void> => {
    const { id, roleKey } = validatedParams<{ id: string; roleKey: string }>(req);
    await this.ensureUserExists(id);
    await this.rbac.removeRoleFromUser(id, roleKey, this.actor(req));
    sendSuccess(res, { userId: id, roles: await this.rbac.getRoleKeysForUser(id) });
  };

  private async changeStatus(
    req: Request,
    res: Response,
    status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED',
  ): Promise<void> {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<StatusChangeBody>(req);
    const user = await this.users.setStatus(id, status, this.actor(req), body.reason);
    sendSuccess(res, toPublicUser(user));
  }

  private async ensureUserExists(id: string): Promise<void> {
    if (!(await this.users.getByIdOrNull(id))) throw new NotFoundError('User not found');
  }
}
