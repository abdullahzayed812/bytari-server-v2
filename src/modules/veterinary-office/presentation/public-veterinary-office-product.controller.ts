import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import type { VeterinaryOfficeProductService } from '../application/veterinary-office-product.service.js';
import type { PublicListVeterinaryOfficeProductsQuery } from './veterinary-office-product.schemas.js';

/**
 * Public product-catalog browse for VETERINARY_OFFICE organizations — the
 * Veterinary Offices product screens. Any authenticated user, not just
 * members. No business logic — `VeterinaryOfficeProductService.listPublic` /
 * `getPublic` enforce ACTIVE organization + ACTIVE product.
 */
export class PublicVeterinaryOfficeProductController {
  constructor(private readonly products: VeterinaryOfficeProductService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const q = validatedQuery<PublicListVeterinaryOfficeProductsQuery>(req);
    const { items, total } = await this.products.listPublic(organizationId, {
      page: q.page,
      pageSize: q.pageSize,
      productType: q.type,
      search: q.search,
      sort: q.sort,
      order: q.order,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { organizationId, productId } = validatedParams<{
      organizationId: string;
      productId: string;
    }>(req);
    sendSuccess(res, await this.products.getPublic(organizationId, productId));
  };
}
