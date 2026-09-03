import type { Request, RequestHandler } from 'express';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import { FARM_ORG_TYPE } from '../domain/farm.constants.js';
import type { PoultryFlockRepository } from '../infrastructure/poultry-flock.repository.js';

/**
 * MUST run after `withOrganization`. Rejects any organization that is not a
 * FARM (`400`) — the poultry / operations routes are farm-only. The type comes
 * from the resolved organization, never the request body.
 */
export const withFarmOrganization: RequestHandler = asyncHandler((req, _res, next) => {
  const org = requireOrganization(req);
  if (org.type !== FARM_ORG_TYPE) {
    throw new BadRequestError('This operation is only available for farm organizations', {
      code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
    });
  }
  next();
});

/** Narrow `req.poultryFlock` inside a controller that runs after `withPoultryFlock`. */
export function requirePoultryFlock(req: Request): Express.PoultryFlockContext {
  if (!req.poultryFlock) throw new NotFoundError('Poultry flock not found');
  return req.poultryFlock;
}

/**
 * MUST run after `withOrganization` + `authorizeOrg('farm.poultry.*')`.
 * Resolves `:flockId` scoped to the URL's organization → `req.poultryFlock`.
 * A flock id that does not exist under this farm returns `404` (cross-farm
 * isolation — Farm A cannot probe Farm B's flock ids).
 */
export function createFarmMiddleware(deps: { flocks: PoultryFlockRepository }): {
  withPoultryFlock: RequestHandler;
} {
  const withPoultryFlock: RequestHandler = asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    const { flockId } = validatedParams<{ flockId: string }>(req);
    const flock = await deps.flocks.findByIdForOrganization(flockId, org.id);
    if (!flock) throw new NotFoundError('Poultry flock not found');
    req.poultryFlock = { id: flock.id, status: flock.status, organizationId: flock.organizationId };
    next();
  });

  return { withPoultryFlock };
}
