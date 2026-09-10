import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { ProductController } from './product.controller.js';
import { PublicProductController } from './public-product.controller.js';
import { createStoreMiddleware, withProductOrganization } from './store.middleware.js';
import {
  adjustStockBodySchema,
  createProductBodySchema,
  finalizeProductImageBodySchema,
  listProductsQuerySchema,
  productImageParamSchema,
  productImageUploadUrlBodySchema,
  productParamSchema,
  publicListProductsQuerySchema,
  publicProductParamSchema,
  storeIdParamSchema,
  updateProductBodySchema,
} from './store.schemas.js';

/**
 * Product routes for organizations that can own products (a VETERINARY_STORE
 * or a VETERINARY_OFFICE), mounted at `/organizations` alongside the Phase 3
 * organization router. Everything about the organization itself (create /
 * approve / profile / members / supervisors) is Phase 3. This module adds only
 * product management. Every route here is:
 *
 *   authenticate → validate → withOrganization → withProductOrganization (type gate)
 *                → authorizeOrg(<product perm>) → [withProduct for :productId]
 *
 * so the caller must be an ACTIVE member with the right organization
 * permission. ADMIN overrides `authorizeOrg`.
 */
export function createVeterinaryStoreRouter(c: Container): Router {
  const ctrl = new ProductController(c.productService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { withProduct } = createStoreMiddleware({ products: c.productRepository });

  const r = Router();
  r.use(c.authenticate);

  const base = '/:organizationId/products';

  r.get(
    base,
    validate({ params: storeIdParamSchema, query: listProductsQuerySchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.read'),
    asyncHandler(ctrl.list),
  );
  r.post(
    base,
    validate({ params: storeIdParamSchema, body: createProductBodySchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.create'),
    asyncHandler(ctrl.create),
  );
  r.get(
    `${base}/:productId`,
    validate({ params: productParamSchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.read'),
    withProduct,
    asyncHandler(ctrl.getOne),
  );
  r.patch(
    `${base}/:productId`,
    validate({ params: productParamSchema, body: updateProductBodySchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.update'),
    withProduct,
    asyncHandler(ctrl.update),
  );
  r.delete(
    `${base}/:productId`,
    validate({ params: productParamSchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.delete'),
    withProduct,
    asyncHandler(ctrl.deactivate),
  );
  r.post(
    `${base}/:productId/stock`,
    validate({ params: productParamSchema, body: adjustStockBodySchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.inventory.adjust'),
    withProduct,
    asyncHandler(ctrl.adjustStock),
  );

  // Images — same guard as PATCH (`product.update`), same presigned-direct-to-R2
  // seam as the organization gallery / Pet Owners Store products.
  r.post(
    `${base}/:productId/images/upload-url`,
    validate({ params: productParamSchema, body: productImageUploadUrlBodySchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.update'),
    withProduct,
    asyncHandler(ctrl.requestImageUploadUrl),
  );
  r.post(
    `${base}/:productId/images`,
    validate({ params: productParamSchema, body: finalizeProductImageBodySchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.update'),
    withProduct,
    asyncHandler(ctrl.addImage),
  );
  r.delete(
    `${base}/:productId/images/:imageId`,
    validate({ params: productImageParamSchema }),
    withOrganization,
    withProductOrganization,
    authorizeOrg('product.update'),
    withProduct,
    asyncHandler(ctrl.removeImage),
  );

  return r;
}

/**
 * Public product-catalog browse — mounted under the same `/organizations/discover`
 * namespace as `organization.routes.ts`. Any authenticated user, not just
 * members: the Veterinary Offices product-browsing screens. `authenticate`
 * only; `ProductService.listPublic` / `getPublic` enforce ACTIVE organization +
 * ACTIVE product (same visibility rule as `organizations/discover/:id`).
 */
export function createPublicProductRouter(c: Container): Router {
  const ctrl = new PublicProductController(c.productService);
  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/discover/:organizationId/products',
    validate({ params: storeIdParamSchema, query: publicListProductsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.get(
    '/discover/:organizationId/products/:productId',
    validate({ params: publicProductParamSchema }),
    asyncHandler(ctrl.getOne),
  );

  return r;
}
