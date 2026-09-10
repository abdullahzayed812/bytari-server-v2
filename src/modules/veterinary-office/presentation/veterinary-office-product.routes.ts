import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { VeterinaryOfficeProductController } from './veterinary-office-product.controller.js';
import { PublicVeterinaryOfficeProductController } from './public-veterinary-office-product.controller.js';
import {
  createVeterinaryOfficeProductMiddleware,
  withVeterinaryOffice,
} from './veterinary-office-product.middleware.js';
import {
  adjustVeterinaryOfficeStockBodySchema,
  createVeterinaryOfficeProductBodySchema,
  finalizeVeterinaryOfficeProductImageBodySchema,
  listVeterinaryOfficeProductsQuerySchema,
  publicListVeterinaryOfficeProductsQuerySchema,
  publicVeterinaryOfficeProductParamSchema,
  updateVeterinaryOfficeProductBodySchema,
  veterinaryOfficeIdParamSchema,
  veterinaryOfficeProductImageParamSchema,
  veterinaryOfficeProductImageUploadUrlBodySchema,
  veterinaryOfficeProductParamSchema,
} from './veterinary-office-product.schemas.js';

/**
 * Product routes for VETERINARY_OFFICE organizations, mounted at
 * `/organizations` alongside the Phase 3 organization router. Everything
 * about the organization itself (create / approve / profile / members /
 * supervisors) is Phase 3. This module adds only product management for its
 * own catalog — a Veterinary Store's products are a fully separate module
 * (`veterinary-store`), never reachable from here. Path segment
 * `office-products` (not `products`) so the route can never collide with the
 * Veterinary Store router mounted at the same `/organizations` prefix. Every
 * route is:
 *
 *   authenticate → validate → withOrganization → withVeterinaryOffice (type gate)
 *                → authorizeOrg(<product perm>) → [withVeterinaryOfficeProduct for :productId]
 *
 * so the caller must be an ACTIVE member with the right organization
 * permission. ADMIN overrides `authorizeOrg`.
 */
export function createVeterinaryOfficeProductRouter(c: Container): Router {
  const ctrl = new VeterinaryOfficeProductController(c.veterinaryOfficeProductService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { withVeterinaryOfficeProduct } = createVeterinaryOfficeProductMiddleware({
    products: c.veterinaryOfficeProductRepository,
  });

  const r = Router();
  r.use(c.authenticate);

  const base = '/:organizationId/office-products';

  r.get(
    base,
    validate({ params: veterinaryOfficeIdParamSchema, query: listVeterinaryOfficeProductsQuerySchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.read'),
    asyncHandler(ctrl.list),
  );
  r.post(
    base,
    validate({ params: veterinaryOfficeIdParamSchema, body: createVeterinaryOfficeProductBodySchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.create'),
    asyncHandler(ctrl.create),
  );
  r.get(
    `${base}/:productId`,
    validate({ params: veterinaryOfficeProductParamSchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.read'),
    withVeterinaryOfficeProduct,
    asyncHandler(ctrl.getOne),
  );
  r.patch(
    `${base}/:productId`,
    validate({ params: veterinaryOfficeProductParamSchema, body: updateVeterinaryOfficeProductBodySchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.update'),
    withVeterinaryOfficeProduct,
    asyncHandler(ctrl.update),
  );
  r.delete(
    `${base}/:productId`,
    validate({ params: veterinaryOfficeProductParamSchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.delete'),
    withVeterinaryOfficeProduct,
    asyncHandler(ctrl.deactivate),
  );
  r.post(
    `${base}/:productId/stock`,
    validate({ params: veterinaryOfficeProductParamSchema, body: adjustVeterinaryOfficeStockBodySchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.inventory.adjust'),
    withVeterinaryOfficeProduct,
    asyncHandler(ctrl.adjustStock),
  );

  // Images — same guard as PATCH (`product.update`), same presigned-direct-to-R2
  // seam as the organization gallery / Pet Owners Store products.
  r.post(
    `${base}/:productId/images/upload-url`,
    validate({ params: veterinaryOfficeProductParamSchema, body: veterinaryOfficeProductImageUploadUrlBodySchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.update'),
    withVeterinaryOfficeProduct,
    asyncHandler(ctrl.requestImageUploadUrl),
  );
  r.post(
    `${base}/:productId/images`,
    validate({ params: veterinaryOfficeProductParamSchema, body: finalizeVeterinaryOfficeProductImageBodySchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.update'),
    withVeterinaryOfficeProduct,
    asyncHandler(ctrl.addImage),
  );
  r.delete(
    `${base}/:productId/images/:imageId`,
    validate({ params: veterinaryOfficeProductImageParamSchema }),
    withOrganization,
    withVeterinaryOffice,
    authorizeOrg('product.update'),
    withVeterinaryOfficeProduct,
    asyncHandler(ctrl.removeImage),
  );

  return r;
}

/**
 * Public product-catalog browse for VETERINARY_OFFICE organizations —
 * mounted under the same `/organizations/discover` namespace as
 * `organization.routes.ts`. Any authenticated user, not just members: the
 * Veterinary Offices product-browsing screens. `authenticate` only;
 * `VeterinaryOfficeProductService.listPublic` / `getPublic` enforce ACTIVE
 * organization + ACTIVE product.
 */
export function createPublicVeterinaryOfficeProductRouter(c: Container): Router {
  const ctrl = new PublicVeterinaryOfficeProductController(c.veterinaryOfficeProductService);
  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/discover/:organizationId/office-products',
    validate({ params: veterinaryOfficeIdParamSchema, query: publicListVeterinaryOfficeProductsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.get(
    '/discover/:organizationId/office-products/:productId',
    validate({ params: publicVeterinaryOfficeProductParamSchema }),
    asyncHandler(ctrl.getOne),
  );

  return r;
}
