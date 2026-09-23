import type { Request, RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import { asyncHandler } from '../../shared/http/async-handler.js';
import type { RoleRepository } from '../rbac/role.repository.js';
import { accessStateFor } from '../users/user-access.js';
import type { UserService } from '../users/user.service.js';
import type { TokenService } from './token.service.js';

export interface AuthenticateDeps {
  tokens: TokenService;
  users: UserService;
  roles: RoleRepository;
}

export interface CreateAuthenticateOptions {
  /**
   * Let an account that is still ONBOARDING through — a Pet Owner whose email
   * is not verified (`EMAIL_VERIFICATION_REQUIRED`) or a veterinarian-registered
   * account not yet approved (`VETERINARIAN_APPROVAL_REQUIRED`); see
   * `accessStateFor`. OFF by default — every route gets the strict guard
   * unless it explicitly opts in.
   *
   * Reserve this for the small, explicit self-service allowlist an onboarding
   * user needs: `GET /auth/me` (so the client can detect the state and route
   * to the verify / pending-approval screen); `POST /auth/logout` +
   * `POST /auth/logout-all`; `POST /users/me/avatar/upload-url` +
   * `POST /users/me/avatar` (the avatar picked during registration); and, for
   * a veterinarian applicant, `POST /veterinarians/documents/upload-url`,
   * `POST /veterinarians/apply` (also a rejected applicant re-applying) and
   * `GET /veterinarians/me/status`. Every other route must keep using the
   * DEFAULT (strict) guard so this stays an intentional, reviewable list, not
   * an accidental blanket relaxation. Never widen it without updating this comment.
   */
  allowOnboarding?: boolean;
}

/**
 * Verify the `Authorization: Bearer <jwt>` access token, load the user, and
 * attach `req.auth`. Rejects unknown/expired tokens and non-ACTIVE accounts —
 * a suspended or deactivated user cannot act even with a still-valid token.
 * Onboarding accounts (unverified Pet Owner → 401 `EMAIL_VERIFICATION_REQUIRED`;
 * unapproved Veterinarian → 403 `VETERINARIAN_ACCOUNT_PENDING_APPROVAL`) are rejected
 * too UNLESS `options.allowOnboarding` is set (see {@link CreateAuthenticateOptions}).
 * Status is re-read on every request, so an admin approval takes effect on the
 * very next call with the same token.
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
    const access = accessStateFor(user);
    const onboardingOk =
      options.allowOnboarding &&
      (access === 'EMAIL_VERIFICATION_REQUIRED' || access === 'VETERINARIAN_APPROVAL_REQUIRED');
    if (access !== 'FULL' && !onboardingOk) {
      if (access === 'VETERINARIAN_APPROVAL_REQUIRED') {
        // 403, not 401: the session is valid — the client must not treat this as expiry.
        throw new ForbiddenError('Your veterinarian registration is awaiting admin approval', {
          code: ErrorCode.VETERINARIAN_ACCOUNT_PENDING_APPROVAL,
        });
      }
      const code =
        access === 'EMAIL_VERIFICATION_REQUIRED'
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
