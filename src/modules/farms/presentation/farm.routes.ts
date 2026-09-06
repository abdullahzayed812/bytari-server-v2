import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createAuthorizationMiddleware } from '../../authorization/authorization.middleware.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { FarmController } from './farm.controller.js';
import { PoultryController } from './poultry.controller.js';
import { createFarmSubscriptionMiddleware } from './farm.middleware.js';
import { createPoultryFlockMiddleware } from './poultry-flock.middleware.js';
import { joinFarmBodySchema } from './farm.schemas.js';
import {
  createPoultryFarmBodySchema,
  createPoultryFlockBodySchema,
  flockParamSchema,
  listPoultryFlocksQuerySchema,
  organizationPoultryParamSchema,
  updatePoultryFlockBodySchema,
} from './poultry-flock.schemas.js';

/**
 * Farm-specific routes, mounted at `/organizations` alongside the Phase 3
 * organization router and the Phase 5 clinical router. Everything else about a
 * farm (create, approve, profile, members, supervisors) is already served by
 * Phase 3 — this module adds only:
 *
 *   POST   /organizations/join                                   (Farm-ID join flow)
 *   GET    /organizations/:organizationId/join-code              (read the code)
 *   POST   /organizations/:organizationId/join-code/regenerate   (rotate the code)
 *   …/organizations/:organizationId/poultry/flocks[/:flockId]    (poultry CRUD)
 */
export function createFarmRouter(c: Container): Router {
  const farmCtrl = new FarmController(c.farmJoinService, c.organizationService);
  const poultryCtrl = new PoultryController(c.poultryFlockService);
  const { requireApprovedVeterinarian } = createAuthorizationMiddleware(c.authorizationService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { requireActiveFarmSubscription } = createFarmSubscriptionMiddleware({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });
  const { withPoultryFlock } = createPoultryFlockMiddleware({
    flocks: c.poultryFlockRepository,
  });

  const r = Router();
  r.use(c.authenticate);

  // --- "Add Poultry Farm" (domain-specific creation form) ------
  // Any ACTIVE user (a Pet Owner included) creates their own farm; the org is
  // created PENDING and the caller becomes its OWNER. No `authorizeOrg` — there
  // is no organization yet; `OrganizationService.create` runs the create policy.
  r.post(
    '/farms',
    validate({ body: createPoultryFarmBodySchema }),
    asyncHandler(farmCtrl.createPoultryFarm),
  );

  // --- Farm-ID join flow ---------------------------------------
  r.post(
    '/join',
    requireApprovedVeterinarian(),
    validate({ body: joinFarmBodySchema }),
    asyncHandler(farmCtrl.joinByCode),
  );

  r.get(
    '/:organizationId/join-code',
    validate({ params: organizationPoultryParamSchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(farmCtrl.getJoinCode),
  );
  r.post(
    '/:organizationId/join-code/regenerate',
    validate({ params: organizationPoultryParamSchema }),
    withOrganization,
    authorizeOrg('organization.update'),
    asyncHandler(farmCtrl.regenerateJoinCode),
  );

  // --- poultry flocks -----------------------------------------
  // Every route here requires an ACTIVE subscription (spec: no farm operation
  // while EXPIRED/NOT_STARTED) — an ADMIN bypasses, same as `authorizeOrg`.
  const flocksBase = '/:organizationId/poultry/flocks';
  r.get(
    flocksBase,
    validate({ params: organizationPoultryParamSchema, query: listPoultryFlocksQuerySchema }),
    withOrganization,
    authorizeOrg('farm.poultry.read'),
    requireActiveFarmSubscription,
    asyncHandler(poultryCtrl.listFlocks),
  );
  r.post(
    flocksBase,
    validate({ params: organizationPoultryParamSchema, body: createPoultryFlockBodySchema }),
    withOrganization,
    authorizeOrg('farm.poultry.create'),
    requireActiveFarmSubscription,
    asyncHandler(poultryCtrl.createFlock),
  );
  r.get(
    `${flocksBase}/:flockId`,
    validate({ params: flockParamSchema }),
    withOrganization,
    authorizeOrg('farm.poultry.read'),
    requireActiveFarmSubscription,
    withPoultryFlock,
    asyncHandler(poultryCtrl.getFlock),
  );
  r.patch(
    `${flocksBase}/:flockId`,
    validate({ params: flockParamSchema, body: updatePoultryFlockBodySchema }),
    withOrganization,
    authorizeOrg('farm.poultry.update'),
    requireActiveFarmSubscription,
    withPoultryFlock,
    asyncHandler(poultryCtrl.updateFlock),
  );
  r.delete(
    `${flocksBase}/:flockId`,
    validate({ params: flockParamSchema }),
    withOrganization,
    authorizeOrg('farm.poultry.delete'),
    requireActiveFarmSubscription,
    withPoultryFlock,
    asyncHandler(poultryCtrl.deleteFlock),
  );

  return r;
}
