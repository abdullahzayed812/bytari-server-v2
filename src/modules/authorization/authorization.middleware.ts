import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import type { AuthorizationService } from './authorization.service.js';

/**
 * Route guards backed by {@link AuthorizationService}. Every guard runs AFTER
 * `authenticate`. Authorization decisions live in the service — these are thin
 * adapters so controllers never contain `if (role === 'ADMIN')` logic.
 */
export interface AuthorizationMiddleware {
  /** Require the given permission (ADMIN bypasses via the central override). */
  authorize: (permission: string) => RequestHandler;
  /** Require an approved veterinarian account (role + status = APPROVED). */
  requireApprovedVeterinarian: () => RequestHandler;
}

export function createAuthorizationMiddleware(
  authz: AuthorizationService,
): AuthorizationMiddleware {
  const authorize = (permission: string): RequestHandler =>
    asyncHandler(async (req, _res, next) => {
      await authz.assert(requireAuth(req), permission);
      next();
    });

  const requireApprovedVeterinarian = (): RequestHandler =>
    asyncHandler((req, _res, next) => {
      authz.assertApprovedVeterinarian(requireAuth(req));
      next();
    });

  return { authorize, requireApprovedVeterinarian };
}
