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

export interface CreateAuthenticateOptions {
  /**
   * Let a `PENDING_VERIFICATION` account's token through. OFF by default —
   * every route gets the strict guard unless it explicitly opts in.
   *
   * Reserve this for the small, explicit self-service allowlist a
   * freshly-registered-but-not-yet-verified user needs to finish registering:
   * `GET /auth/me` (so the client can detect the pending state and route to
   * the verify screen); `POST /users/me/avatar/upload-url` +
   * `POST /users/me/avatar` (the avatar picked during registration); and, for
   * a veterinarian applicant, `POST /veterinarians/documents/upload-url`,
   * `POST /veterinarians/apply` and `GET /veterinarians/me/status`. Every
   * other route — the other ~150 — must keep using the DEFAULT (strict) guard
   * so this stays an intentional, reviewable list, not an accidental blanket
   * relaxation. Never widen it without updating this comment.
   */
  allowPendingVerification?: boolean;
}

/**
 * Verify the `Authorization: Bearer <jwt>` access token, load the user, and
 * attach `req.auth`. Rejects unknown/expired tokens and non-ACTIVE accounts —
 * a suspended or deactivated user cannot act even with a still-valid token.
 * `PENDING_VERIFICATION` is rejected here too UNLESS
 * `options.allowPendingVerification` is set (see {@link CreateAuthenticateOptions}).
 */
export function createAuthenticate(
  deps: AuthenticateDeps,
  options: CreateAuthenticateOptions = {},
): RequestHandler {
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
    const pendingOk = options.allowPendingVerification && user.status === 'PENDING_VERIFICATION';
    if (user.status !== 'ACTIVE' && !pendingOk) {
      const code =
        user.status === 'PENDING_VERIFICATION'
          ? ErrorCode.EMAIL_VERIFICATION_REQUIRED
          : ErrorCode.ACCOUNT_INACTIVE;
      throw new UnauthorizedError(`Account is ${user.status.toLowerCase()}`, { code });
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
