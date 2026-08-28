import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { ProductController } from './product.controller.js';
import { createStoreMiddleware, withVeterinaryStore } from './store.middleware.js';
import {
  adjustStockBodySchema,
  createProductBodySchema,
  listProductsQuerySchema,
  productParamSchema,
  storeIdParamSchema,
  updateProductBodySchema,
} from './store.schemas.js';

/**
 * Veterinary Store product routes, mounted at `/organizations` alongside the
 * Phase 3 organization router. Everything about the store *organization*
 * (create / approve / profile / members / supervisors) is Phase 3. Every route
 * here is:
 *
 *   authenticate → validate → withOrganization → withVeterinaryStore (type gate)
 *                → authorizeOrg(<product perm>) → [withProduct for :productId]
 *
 * so the caller must be an ACTIVE member of a VETERINARY_STORE with the right
 * organization permission. ADMIN overrides `authorizeOrg`.
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
    withVeterinaryStore,
    authorizeOrg('product.read'),
    asyncHandler(ctrl.list),
  );
  r.post(
    base,
    validate({ params: storeIdParamSchema, body: createProductBodySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.create'),
    asyncHandler(ctrl.create),
  );
  r.get(
    `${base}/:productId`,
    validate({ params: productParamSchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.read'),
    withProduct,
    asyncHandler(ctrl.getOne),
  );
  r.patch(
    `${base}/:productId`,
    validate({ params: productParamSchema, body: updateProductBodySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.update'),
    withProduct,
    asyncHandler(ctrl.update),
  );
  r.delete(
    `${base}/:productId`,
    validate({ params: productParamSchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.delete'),
    withProduct,
    asyncHandler(ctrl.deactivate),
  );
  r.post(
    `${base}/:productId/stock`,
    validate({ params: productParamSchema, body: adjustStockBodySchema }),
    withOrganization,
    withVeterinaryStore,
    authorizeOrg('product.inventory.adjust'),
    withProduct,
    asyncHandler(ctrl.adjustStock),
  );

  return r;
}
