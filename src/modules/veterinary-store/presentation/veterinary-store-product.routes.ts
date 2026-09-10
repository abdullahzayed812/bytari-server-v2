import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { VeterinaryStoreProductController } from './veterinary-store-product.controller.js';
import { PublicVeterinaryStoreProductController } from './public-veterinary-store-product.controller.js';
import {
  createVeterinaryStoreProductMiddleware,
  withVeterinaryStore,
} from './veterinary-store-product.middleware.js';
import {
  adjustVeterinaryStoreStockBodySchema,
  createVeterinaryStoreProductBodySchema,
  finalizeVeterinaryStoreProductImageBodySchema,
  listVeterinaryStoreProductsQuerySchema,
  publicListVeterinaryStoreProductsQuerySchema,
  publicVeterinaryStoreProductParamSchema,
  updateVeterinaryStoreProductBodySchema,
  veterinaryStoreIdParamSchema,
  veterinaryStoreProductImageParamSchema,
  veterinaryStoreProductImageUploadUrlBodySchema,
  veterinaryStoreProductParamSchema,
} from './veterinary-store-product.schemas.js';

/**
 * Product routes for VETERINARY_STORE organizations, mounted at
 * `/organizations` alongside the Phase 3 organization router. Everything
 * about the organization itself (create / approve / profile / members /
 * supervisors) is Phase 3. This module adds only product management for its
 * own catalog — a Veterinary Office's products are a fully separate module
 * (`veterinary-office-products`), never reachable from here. Every route is:
 *
 *   authenticate → validate → withOrganization → withVeterinaryStore (type gate)
 *                → authorizeOrg(<product perm>) → [withVeterinaryStoreProduct for :productId]
 *
 * so the caller must be an ACTIVE member with the right organization
 * permission. ADMIN overrides `authorizeOrg`.
 */
export function createVeterinaryStoreProductRouter(c: Container): Router {
  const ctrl = new VeterinaryStoreProductController(c.veterinaryStoreProductService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { withVeterinaryStoreProduct } = createVeterinaryStoreProductMiddleware({
    products: c.veterinaryStoreProductRepository,
  });

  const r = Router();
  r.use(c.authenticate);

  const base = '/:organizationId/store-products';

  r.get(
    base,
    validate({ params: veterinaryStoreIdParamSchema, query: listVeterinaryStoreProductsQuerySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.read'),
    asyncHandler(ctrl.list),
  );
  r.post(
    base,
    validate({ params: veterinaryStoreIdParamSchema, body: createVeterinaryStoreProductBodySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.create'),
    asyncHandler(ctrl.create),
  );
  r.get(
    `${base}/:productId`,
    validate({ params: veterinaryStoreProductParamSchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.read'),
    withVeterinaryStoreProduct,
    asyncHandler(ctrl.getOne),
  );
  r.patch(
    `${base}/:productId`,
    validate({ params: veterinaryStoreProductParamSchema, body: updateVeterinaryStoreProductBodySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.update'),
    withVeterinaryStoreProduct,
    asyncHandler(ctrl.update),
  );
  r.delete(
    `${base}/:productId`,
    validate({ params: veterinaryStoreProductParamSchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.delete'),
    withVeterinaryStoreProduct,
    asyncHandler(ctrl.deactivate),
  );
  r.post(
    `${base}/:productId/stock`,
    validate({ params: veterinaryStoreProductParamSchema, body: adjustVeterinaryStoreStockBodySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.inventory.adjust'),
    withVeterinaryStoreProduct,
    asyncHandler(ctrl.adjustStock),
  );

  // Images — same guard as PATCH (`product.update`), same presigned-direct-to-R2
  // seam as the organization gallery / Pet Owners Store products.
  r.post(
    `${base}/:productId/images/upload-url`,
    validate({ params: veterinaryStoreProductParamSchema, body: veterinaryStoreProductImageUploadUrlBodySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.update'),
    withVeterinaryStoreProduct,
    asyncHandler(ctrl.requestImageUploadUrl),
  );
  r.post(
    `${base}/:productId/images`,
    validate({ params: veterinaryStoreProductParamSchema, body: finalizeVeterinaryStoreProductImageBodySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.update'),
    withVeterinaryStoreProduct,
    asyncHandler(ctrl.addImage),
  );
  r.delete(
    `${base}/:productId/images/:imageId`,
    validate({ params: veterinaryStoreProductImageParamSchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.update'),
    withVeterinaryStoreProduct,
    asyncHandler(ctrl.removeImage),
  );

  return r;
}

/**
 * Public product-catalog browse for VETERINARY_STORE organizations — mounted
 * under the same `/organizations/discover` namespace as
 * `organization.routes.ts`. Any authenticated user, not just members.
 * `authenticate` only; `VeterinaryStoreProductService.listPublic` / `getPublic`
 * enforce ACTIVE organization + ACTIVE product.
 */
export function createPublicVeterinaryStoreProductRouter(c: Container): Router {
  const ctrl = new PublicVeterinaryStoreProductController(c.veterinaryStoreProductService);
  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/discover/:organizationId/store-products',
    validate({ params: veterinaryStoreIdParamSchema, query: publicListVeterinaryStoreProductsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.get(
    '/discover/:organizationId/store-products/:productId',
    validate({ params: publicVeterinaryStoreProductParamSchema }),
    asyncHandler(ctrl.getOne),
  );

  return r;
}
