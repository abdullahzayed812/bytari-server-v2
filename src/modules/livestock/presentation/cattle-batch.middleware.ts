import type { Request, RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { CattleBatchRepository } from '../infrastructure/cattle-batch.repository.js';

/** Narrow `req.cattleBatch` inside a controller that runs after `withCattleBatch`. */
export function requireCattleBatch(req: Request): Express.CattleBatchContext {
  if (!req.cattleBatch) throw new NotFoundError('Cattle batch not found');
  return req.cattleBatch;
}

/**
 * MUST run after `withOrganization` + `authorizeOrg('farm.cattle_batch.*')`.
 * Resolves `:batchId` scoped to the URL's organization → `req.cattleBatch`.
 * A batch id that does not exist under this farm returns `404` (cross-farm
 * isolation).
 */
export function createCattleBatchMiddleware(deps: {
  batches: CattleBatchRepository;
}): {
  withCattleBatch: RequestHandler;
} {
  const withCattleBatch: RequestHandler = asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    const { batchId } = validatedParams<{ batchId: string }>(req);
    const batch = await deps.batches.findByIdForOrganization(batchId, org.id);
    if (!batch) throw new NotFoundError('Cattle batch not found');
    req.cattleBatch = { id: batch.id, status: batch.status, organizationId: batch.organizationId };
    next();
  });

  return { withCattleBatch };
}
