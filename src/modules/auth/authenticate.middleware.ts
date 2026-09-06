import type { Request, RequestHandler } from 'express';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import { asyncHandler } from '../../shared/http/async-handler.js';
import type { RoleRepository } from '../rbac/role.repository.js';
import type { UserService } from '../users/user.service.js';
import type { TokenService } from './token.service.js';

export interface AuthenticateDeps {
  tokens: TokenService;
  users: UserService;
  roles: RoleRepository;
}

/**
 * Verify the `Authorization: Bearer <jwt>` access token, load the user, and
 * attach `req.auth`. Rejects unknown/expired tokens and non-ACTIVE accounts —
 * a suspended or deactivated user cannot act even with a still-valid token.
 */
export function createAuthenticate(deps: AuthenticateDeps): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header', {
        code: ErrorCode.INVALID_TOKEN,
      });
    }

    const { userId, sessionId } = await deps.tokens.verifyAccessToken(header.slice(7).trim());

    const user = await deps.users.getByIdOrNull(userId);
    if (!user) {
      throw new UnauthorizedError('Account no longer exists', { code: ErrorCode.INVALID_TOKEN });
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError(`Account is ${user.status.toLowerCase()}`, {
        code: ErrorCode.ACCOUNT_INACTIVE,
      });
    }

    req.auth = {
      userId: user.id,
      email: user.email,
      status: user.status,
      veterinarianStatus: user.veterinarianStatus,
      traderStatus: user.traderStatus,
      roleKeys: await deps.roles.getRoleKeysForUser(user.id),
      sessionId,
    };
    next();
  });
}

/** Narrow `req.auth` for use inside a controller that runs after `authenticate`. */
export function requireAuth(req: Request): Express.AuthContext {
  if (!req.auth) {
    throw new UnauthorizedError('Authentication required', { code: ErrorCode.UNAUTHORIZED });
  }
  return req.auth;
}
