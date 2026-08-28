import type { RequestHandler } from 'express';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';

/**
 * Content-management guard. Combines the standard permission check
 * (`authz.assert` → ADMIN override or the CONTENT system-supervisor domain)
 * with the Phase-14 rule that a Content Supervisor **must be an approved
 * veterinarian** (brief §4). The check is live — revoking vet approval or the
 * supervisor assignment removes access on the next request.
 */
export function createContentAuthz(authz: AuthorizationService): {
  authorizeContent: (permission: string) => RequestHandler;
} {
  const authorizeContent = (permission: string): RequestHandler =>
    asyncHandler(async (req, _res, next) => {
      const principal = requireAuth(req);
      await authz.assert(principal, permission);
      if (!authz.isAdmin(principal) && !authz.isApprovedVeterinarian(principal)) {
        throw new ForbiddenError('Content management requires an approved veterinarian account', {
          code: ErrorCode.PERMISSION_DENIED,
        });
      }
      next();
    });

  return { authorizeContent };
}
