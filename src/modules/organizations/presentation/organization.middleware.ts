import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { OrganizationRepository } from '../infrastructure/organization.repository.js';

export const organizationIdParamSchema = z.object({ organizationId: z.string().uuid() });

export interface OrganizationMiddleware {
  /**
   * Resolve `:organizationId` (trusted route param) → `req.organization`.
   * 404 if the organization does not exist. Does NOT authorize.
   */
  withOrganization: RequestHandler;
  /**
   * Require an org-scoped `permission` for the resolved organization. For
   * non-ADMIN callers the organization must also be ACTIVE (spec §33).
   */
  authorizeOrg: (permission: string) => RequestHandler;
}

/** Narrow `req.organization` inside a controller that runs after `withOrganization`. */
export function requireOrganization(req: Request): Express.OrganizationContext {
  if (!req.organization) {
    throw new NotFoundError('Organization context is not available');
  }
  return req.organization;
}

export function createOrganizationMiddleware(deps: {
  organizations: OrganizationRepository;
  authz: AuthorizationService;
}): OrganizationMiddleware {
  const withOrganization: RequestHandler = asyncHandler(async (req, _res, next) => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const org = await deps.organizations.findById(organizationId);
    if (!org) throw new NotFoundError('Organization not found');
    req.organization = {
      id: org.id,
      type: org.type,
      status: org.status,
      ownerUserId: org.ownerUserId,
    };
    next();
  });

  const authorizeOrg = (permission: string): RequestHandler =>
    asyncHandler(async (req, _res, next) => {
      const principal = requireAuth(req);
      const org = requireOrganization(req);
      const isAdmin = deps.authz.isAdmin(principal);

      if (!isAdmin && org.status !== 'ACTIVE') {
        throw new ForbiddenError(
          `Organization is ${org.status.toLowerCase()} — operations are restricted`,
          { code: ErrorCode.ORGANIZATION_NOT_ACTIVE },
        );
      }

      await deps.authz.assertInOrganization(principal, permission, org.id);
      next();
    });

  return { withOrganization, authorizeOrg };
}
