import type { RequestHandler } from 'express';
import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { requireOrganization } from './organization.middleware.js';

/**
 * MUST run after `withOrganization`. Gates the generic
 * `/organizations/:id/subscription...` routes to the organization types that use them —
 * VETERINARY_OFFICE and CLINIC (spec §3: same approval/subscription concept as Farms,
 * reusing the Farm infrastructure). FARM keeps its own dedicated
 * `/organizations/:id/farm/subscription...` routes (`withFarmOrganization`) — this
 * middleware rejects FARM here so there is exactly one subscription entry point per type.
 */
const SUBSCRIPTION_CAPABLE_TYPES = new Set(['VETERINARY_OFFICE', 'CLINIC']);

export const withSubscriptionCapableOrganization: RequestHandler = asyncHandler((req, _res, next) => {
  const org = requireOrganization(req);
  if (!SUBSCRIPTION_CAPABLE_TYPES.has(org.type)) {
    throw new BadRequestError(
      'This operation is only available for veterinary office or clinic organizations',
      { code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED },
    );
  }
  next();
});
