import type { Request, RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import { VeterinaryStoreProductPolicy } from '../domain/veterinary-store-product.policy.js';
import type { VeterinaryStoreProductRepository } from '../infrastructure/veterinary-store-product.repository.js';

/** Narrow `req.veterinaryStoreProduct` inside a controller that runs after `withVeterinaryStoreProduct`. */
export function requireVeterinaryStoreProduct(req: Request): Express.VeterinaryStoreProductContext {
  if (!req.veterinaryStoreProduct) throw new NotFoundError('Product not found');
  return req.veterinaryStoreProduct;
}

/**
 * MUST run after `withOrganization`. Rejects any organization that is not a
 * VETERINARY_STORE (`400`) — a Veterinary Office's catalog is a fully
 * separate module. The type comes from the resolved organization, never the
 * request body.
 */
export const withVeterinaryStore: RequestHandler = asyncHandler((req, _res, next) => {
  const org = requireOrganization(req);
  VeterinaryStoreProductPolicy.assertVeterinaryStore(org);
  next();
});

/**
 * MUST run after `withOrganization` + `withVeterinaryStore` + `authorizeOrg`.
 * Resolves `:productId` scoped to the URL's store → `req.veterinaryStoreProduct`.
 * A product id that does not belong to this store returns `404` (cross-store
 * isolation — Store A cannot probe Store B's product ids).
 */
export function createVeterinaryStoreProductMiddleware(deps: {
  products: VeterinaryStoreProductRepository;
}): {
  withVeterinaryStoreProduct: RequestHandler;
} {
  const withVeterinaryStoreProduct: RequestHandler = asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    const { productId } = validatedParams<{ productId: string }>(req);
    const product = await deps.products.findByIdForOrganization(productId, org.id);
    if (!product) throw new NotFoundError('Product not found');
    req.veterinaryStoreProduct = {
      id: product.id,
      status: product.status,
      organizationId: product.organizationId,
    };
    next();
  });

  return { withVeterinaryStoreProduct };
}
