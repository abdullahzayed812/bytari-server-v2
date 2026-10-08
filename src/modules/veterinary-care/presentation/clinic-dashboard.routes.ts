import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  createOrganizationMiddleware,
  organizationIdParamSchema,
  requireOrganization,
} from '../../organizations/presentation/organization.middleware.js';
import { createOrganizationSubscriptionGuard } from '../../organizations/presentation/organization-subscription.middleware.js';
import { VeterinaryCarePolicy } from '../domain/veterinary-care.policy.js';
import { ClinicDashboardController } from './clinic-dashboard.controller.js';
import { createVeterinaryCareMiddleware } from './veterinary-care.middleware.js';
import { clinicAnimalParamSchema } from './veterinary-care.schemas.js';

/** MUST run after `withOrganization` — non-CLINIC organizations get 400 ORGANIZATION_TYPE_NOT_SUPPORTED. */
const withClinic: RequestHandler = asyncHandler((req, _res, next) => {
  VeterinaryCarePolicy.assertVeterinaryOrgType(requireOrganization(req));
  next();
});

/**
 * Clinic Dashboard. Mounted at `/organizations`:
 *
 *  - `GET /:organizationId/clinic-dashboard/summary` — stats + the caller's
 *    effective clinic permissions. Gated like the organization profile
 *    (`organization.read`); each stats section is additionally withheld unless
 *    the caller holds the permission of the list it summarises.
 *  - `GET /:organizationId/animals/:animalId` — the clinic-visible pet
 *    profile. Same chain as the medical routes (`animal.veterinary.access.read`
 *    + a registered pet). Its stats count ONLY this clinic's own records, so
 *    opening a pet never reveals what another clinic did.
 */
export function createClinicDashboardRouter(c: Container): Router {
  const ctrl = new ClinicDashboardController(c.clinicDashboardService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { withClinicAnimal } = createVeterinaryCareMiddleware({ animals: c.animalRepository });

  // Clinic operability (single rule: ACTIVE status — via authorizeOrg — and a
  // non-expired subscription). Applies to owner AND staff; ADMIN bypasses.
  const activeSubscription = createOrganizationSubscriptionGuard({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/:organizationId/clinic-dashboard/summary',
    validate({ params: organizationIdParamSchema }),
    withOrganization,
    withClinic,
    authorizeOrg('organization.read'),
    activeSubscription,
    asyncHandler(ctrl.getSummary),
  );

  r.get(
    '/:organizationId/animals/:animalId',
    validate({ params: clinicAnimalParamSchema }),
    withOrganization,
    withClinic,
    authorizeOrg('animal.veterinary.access.read'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.getAnimal),
  );

  return r;
}
