import type { Request, RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import { StorePolicy } from '../domain/store.policy.js';
import type { ProductRepository } from '../infrastructure/product.repository.js';

/** Narrow `req.product` inside a controller that runs after `withProduct`. */
export function requireProduct(req: Request): Express.ProductContext {
  if (!req.product) throw new NotFoundError('Product not found');
  return req.product;
}

/**
 * MUST run after `withOrganization`. Rejects any organization that is not a
 * VETERINARY_STORE / VETERINARY_OFFICE (`400`) — product management is
 * store-and-office-only. The type comes from the resolved organization, never
 * the request body.
 */
export const withProductOrganization: RequestHandler = asyncHandler((req, _res, next) => {
  const org = requireOrganization(req);
  StorePolicy.assertProductCapable(org);
  next();
});

/**
 * MUST run after `withOrganization` + `withProductOrganization` + `authorizeOrg`.
 * Resolves `:productId` scoped to the URL's organization → `req.product`. A
 * product id that does not belong to this organization returns `404`
 * (cross-tenant isolation — Store/Office A cannot probe Store/Office B's
 * product ids).
 */
export function createStoreMiddleware(deps: { products: ProductRepository }): {
  withProduct: RequestHandler;
} {
  const withProduct: RequestHandler = asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    const { productId } = validatedParams<{ productId: string }>(req);
    const product = await deps.products.findByIdForOrganization(productId, org.id);
    if (!product) throw new NotFoundError('Product not found');
    req.product = {
      id: product.id,
      status: product.status,
      organizationId: product.organizationId,
    };
    next();
  });

  return { withProduct };
}
