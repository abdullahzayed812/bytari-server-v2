import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { withVeterinaryOffice } from './veterinary-office-product.middleware.js';
import { veterinaryOfficeIdParamSchema } from './veterinary-office-product.schemas.js';
import { VeterinaryOfficeDashboardController } from './veterinary-office-dashboard.controller.js';

/** `GET /organizations/:organizationId/office-dashboard/summary` — the Dashboard home's stats row. */
export function createVeterinaryOfficeDashboardRouter(c: Container): Router {
  const ctrl = new VeterinaryOfficeDashboardController(c.veterinaryOfficeDashboardService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/:organizationId/office-dashboard/summary',
    validate({ params: veterinaryOfficeIdParamSchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.read'),
    asyncHandler(ctrl.getSummary),
  );

  return r;
}
