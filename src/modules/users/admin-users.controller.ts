import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { pageMeta } from '../../shared/http/pagination.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../audit/audit-context.js';
import type { AuthService } from '../auth/auth.service.js';
import type { SupportThreadService } from '../consultations/application/support-thread.service.js';
import type { OrganizationService } from '../organizations/application/organization.service.js';
import type { VeterinarianService } from '../veterinarians/veterinarian.service.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import type { RbacService } from '../rbac/rbac.service.js';
import type { UserService } from './user.service.js';
import type {
  AdminMessageUserBody,
  AdminSetPasswordBody,
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
    private readonly veterinarians: VeterinarianService,
    private readonly organizations: OrganizationService,
    private readonly support: SupportThreadService,
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
      role: q.role,
    });
    sendSuccess(
      res,
      await this.users.toPublicUsersWithAvatars(items),
      StatusCodes.OK,
      pageMeta(q.page, q.pageSize, total),
    );
  };

  /**
   * Full admin view of one account: the public profile (avatar resolved, no
   * password hash / storage keys), roles, the veterinarian application (status,
   * sub-type, decision; document metadata only) and the organizations the user
   * is an ACTIVE member of (id/name/type/status/role — no org internals).
   */
  get = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const user = await this.users.getById(id);
    const [roles, publicUser, vet, orgs] = await Promise.all([
      this.rbac.getRoleKeysForUser(id),
      this.users.toPublicUserWithAvatar(user),
      this.veterinarians.getStatus(id),
      this.organizations.listMine(id),
    ]);
    sendSuccess(res, {
      ...publicUser,
      roles,
      veterinarianApplication: vet.application
        ? {
            id: vet.application.id,
            status: vet.application.status,
            subType: vet.application.subType,
            note: vet.application.note,
            decidedAt: vet.application.decidedAt,
            decisionReason: vet.application.decisionReason,
            createdAt: vet.application.createdAt,
            documents: vet.application.documents,
          }
        : null,
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        status: o.status,
        role: o.myRole,
      })),
    });
  };

  /** Admin sets a new password — sessions revoked; the password is never returned. */
  setPassword = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const { newPassword } = validatedBody<AdminSetPasswordBody>(req);
    const result = await this.auth.adminSetPassword(id, newPassword, this.actor(req));
    sendSuccess(res, { userId: id, revokedSessions: result.revokedSessions });
  };

  /** Admin emails the user a reset code (the user chooses their own password). */
  sendPasswordReset = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.auth.adminSendPasswordReset(id, this.actor(req)));
  };

  /** Admin → user message: a SUPPORT thread owned by the user, first message from staff. */
  message = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const { body } = validatedBody<AdminMessageUserBody>(req);
    const thread = await this.support.openForUser(
      { principal: requireAuth(req), context: auditContextFromRequest(req) },
      id,
      body,
      async (userId) => (await this.users.getByIdOrNull(userId)) !== null,
    );
    sendSuccess(res, thread, StatusCodes.CREATED);
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
    sendSuccess(res, await this.users.toPublicUserWithAvatar(user));
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
    sendSuccess(res, await this.users.toPublicUserWithAvatar(user));
  }

  private async ensureUserExists(id: string): Promise<void> {
    if (!(await this.users.getByIdOrNull(id))) throw new NotFoundError('User not found');
  }
}
