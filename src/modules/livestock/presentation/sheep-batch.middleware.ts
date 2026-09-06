import type { Request, RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { SheepBatchRepository } from '../infrastructure/sheep-batch.repository.js';

/** Narrow `req.sheepBatch` inside a controller that runs after `withSheepBatch`. */
export function requireSheepBatch(req: Request): Express.SheepBatchContext {
  if (!req.sheepBatch) throw new NotFoundError('Sheep batch not found');
  return req.sheepBatch;
}

/**
 * MUST run after `withOrganization` + `authorizeOrg('farm.sheep_batch.*')`.
 * Resolves `:batchId` scoped to the URL's organization → `req.sheepBatch`.
 * A batch id that does not exist under this farm returns `404` (cross-farm
 * isolation).
 */
export function createSheepBatchMiddleware(deps: {
  batches: SheepBatchRepository;
}): {
  withSheepBatch: RequestHandler;
} {
  const withSheepBatch: RequestHandler = asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    const { batchId } = validatedParams<{ batchId: string }>(req);
    const batch = await deps.batches.findByIdForOrganization(batchId, org.id);
    if (!batch) throw new NotFoundError('Sheep batch not found');
    req.sheepBatch = { id: batch.id, status: batch.status, organizationId: batch.organizationId };
    next();
  });

  return { withSheepBatch };
}
