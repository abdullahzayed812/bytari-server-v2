import type { RequestHandler } from 'express';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedBody } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import { requireOrganization } from './organization.middleware.js';

/** While under review the owner may still correct the license; afterwards it is locked. */
const LICENSE_EDITABLE_STATUSES = new Set(['PENDING', 'REJECTED']);

/**
 * MUST run after `withOrganization` + `authorizeOrg`. A clinic's / office's
 * license number and license images were reviewed at approval — the owner
 * (and members) can no longer change them from the edit screens once the
 * organization has left review (final corrections §10). A global ADMIN can.
 */
export function createLicenseLock(authz: AuthorizationService): {
  lockLicenseDocuments: RequestHandler;
  lockLicenseNumber: RequestHandler;
} {
  const locked = (req: Parameters<RequestHandler>[0]): boolean => {
    const org = requireOrganization(req);
    if (LICENSE_EDITABLE_STATUSES.has(org.status)) return false;
    return !authz.isAdmin(requireAuth(req));
  };
  const deny = (): never => {
    throw new ForbiddenError(
      'The license number and license images cannot be changed after approval',
      { code: ErrorCode.ORGANIZATION_LICENSE_LOCKED },
    );
  };

  const lockLicenseDocuments: RequestHandler = asyncHandler((req, _res, next) => {
    if (locked(req)) deny();
    next();
  });

  const lockLicenseNumber: RequestHandler = asyncHandler((req, _res, next) => {
    const body = validatedBody<{ licenseNumber?: unknown }>(req);
    if (body.licenseNumber !== undefined && locked(req)) deny();
    next();
  });

  return { lockLicenseDocuments, lockLicenseNumber };
}
