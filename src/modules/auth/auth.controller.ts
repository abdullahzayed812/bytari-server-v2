import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedBody } from '../../shared/http/validate.js';
import { auditContextFromRequest } from '../audit/audit-context.js';
import type { AuthorizationService } from '../authorization/authorization.service.js';
import type { SupervisorService } from '../supervisors/supervisor.service.js';
import { toPublicUser } from '../users/user.mapper.js';
import type { UserService } from '../users/user.service.js';
import type { AuthService } from './auth.service.js';
import { requireAuth } from './authenticate.middleware.js';
import type { LoginBody, LogoutBody, RefreshBody, RegisterBody } from './auth.schemas.js';

/** Thin HTTP adapter for the authentication use-cases. No business logic here. */
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UserService,
    private readonly authz: AuthorizationService,
    private readonly supervisors: SupervisorService,
  ) {}

  register = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<RegisterBody>(req);
    const result = await this.auth.register(body, auditContextFromRequest(req));
    sendSuccess(res, result, StatusCodes.CREATED);
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<LoginBody>(req);
    const result = await this.auth.login(body, auditContextFromRequest(req));
    sendSuccess(res, result);
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<RefreshBody>(req);
    const result = await this.auth.refresh(body.refreshToken, auditContextFromRequest(req));
    sendSuccess(res, result);
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<LogoutBody>(req);
    await this.auth.logout(auth.userId, {
      refreshToken: body.refreshToken,
      sessionId: auth.sessionId,
    });
    sendSuccess(res, { success: true });
  };

  logoutAll = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const revoked = await this.auth.logoutAll(auth.userId, auditContextFromRequest(req));
    sendSuccess(res, { success: true, revokedSessions: revoked });
  };

  me = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const user = await this.users.getById(auth.userId);
    const principal = {
      userId: auth.userId,
      email: auth.email,
      status: auth.status,
      veterinarianStatus: auth.veterinarianStatus,
      roleKeys: auth.roleKeys,
      sessionId: auth.sessionId,
    };
    const [permissions, supervisorDomains] = await Promise.all([
      this.authz.getEffectivePermissions(principal),
      this.supervisors.getActiveDomainsForUser(auth.userId),
    ]);

    sendSuccess(res, {
      user: toPublicUser(user),
      roles: auth.roleKeys,
      permissions,
      isAdmin: this.authz.isAdmin(principal),
      supervisorDomains,
      veterinarian: {
        status: user.veterinarianStatus,
        approved: this.authz.isApprovedVeterinarian(principal),
      },
    });
  };
}
