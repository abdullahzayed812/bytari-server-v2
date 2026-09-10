import type { Request, RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import { VeterinaryOfficeProductPolicy } from '../domain/veterinary-office-product.policy.js';
import type { VeterinaryOfficeProductRepository } from '../infrastructure/veterinary-office-product.repository.js';

/** Narrow `req.veterinaryOfficeProduct` inside a controller that runs after `withVeterinaryOfficeProduct`. */
export function requireVeterinaryOfficeProduct(req: Request): Express.VeterinaryOfficeProductContext {
  if (!req.veterinaryOfficeProduct) throw new NotFoundError('Product not found');
  return req.veterinaryOfficeProduct;
}

/**
 * MUST run after `withOrganization`. Rejects any organization that is not a
 * VETERINARY_OFFICE (`400`) — a Veterinary Store's catalog is a fully
 * separate module. The type comes from the resolved organization, never the
 * request body.
 */
export const withVeterinaryOffice: RequestHandler = asyncHandler((req, _res, next) => {
  const org = requireOrganization(req);
  VeterinaryOfficeProductPolicy.assertVeterinaryOffice(org);
  next();
});

/**
 * MUST run after `withOrganization` + `withVeterinaryOffice` + `authorizeOrg`.
 * Resolves `:productId` scoped to the URL's office → `req.veterinaryOfficeProduct`.
 * A product id that does not belong to this office returns `404` (cross-office
 * isolation — Office A cannot probe Office B's product ids).
 */
export function createVeterinaryOfficeProductMiddleware(deps: {
  products: VeterinaryOfficeProductRepository;
}): {
  withVeterinaryOfficeProduct: RequestHandler;
} {
  const withVeterinaryOfficeProduct: RequestHandler = asyncHandler(async (req, _res, next) => {
    const org = requireOrganization(req);
    const { productId } = validatedParams<{ productId: string }>(req);
    const product = await deps.products.findByIdForOrganization(productId, org.id);
    if (!product) throw new NotFoundError('Product not found');
    req.veterinaryOfficeProduct = {
      id: product.id,
      status: product.status,
      organizationId: product.organizationId,
    };
    next();
  });

  return { withVeterinaryOfficeProduct };
}
