import type { Request, RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { PoultryFlockRepository } from '../infrastructure/poultry-flock.repository.js';

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
export function createPoultryFlockMiddleware(deps: {
  flocks: PoultryFlockRepository;
}): {
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
