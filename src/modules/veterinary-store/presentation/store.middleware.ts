import type { Request, RequestHandler } from 'express';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import { VETERINARY_STORE_ORG_TYPE } from '../domain/store.constants.js';
import type { ProductRepository } from '../infrastructure/product.repository.js';

/** Narrow `req.product` inside a controller that runs after `withProduct`. */
export function requireProduct(req: Request): Express.ProductContext {
  if (!req.product) throw new NotFoundError('Product not found');
  return req.product;
}

/**
 * MUST run after `withOrganization`. Rejects any organization that is not a
 * VETERINARY_STORE (`400`) — product management is store-only (docs 02 §2.3;
 * a Veterinary Office is an independent entity). The type comes from the
 * resolved organization, never the request body.
 */
export const withVeterinaryStore: RequestHandler = asyncHandler((req, _res, next) => {
  const org = requireOrganization(req);
  if (org.type !== VETERINARY_STORE_ORG_TYPE) {
    throw new BadRequestError('Product management is only available for veterinary stores', {
      code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
    });
  }
  next();
});

/**
 * MUST run after `withOrganization` + `withVeterinaryStore` + `authorizeOrg`.
 * Resolves `:productId` scoped to the URL's store → `req.product`. A product id
 * that does not belong to this store returns `404` (cross-store isolation —
 * Store A cannot probe Store B's product ids).
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
