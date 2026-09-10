import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { ProductService } from '../application/product.service.js';
import { requireProduct } from './store.middleware.js';
import type {
  AdjustStockBody,
  CreateProductBody,
  FinalizeProductImageBody,
  ListProductsQuery,
  ProductImageUploadUrlBody,
  UpdateProductBody,
} from './store.schemas.js';

/** Veterinary-store product HTTP adapter. No business logic. */
export class ProductController {
  constructor(private readonly products: ProductService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<CreateProductBody>(req);
    const dto = await this.products.create({ id: org.id, type: org.type }, body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListProductsQuery>(req);
    const { items, total } = await this.products.list(org.id, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      productType: q.type,
      search: q.search,
      sort: q.sort,
      order: q.order,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireProduct(req);
    sendSuccess(res, await this.products.get(org.id, product.id));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireProduct(req);
    const body = validatedBody<UpdateProductBody>(req);
    sendSuccess(res, await this.products.update(org.id, product.id, body, this.actor(req)));
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireProduct(req);
    sendSuccess(res, await this.products.deactivate(org.id, product.id, this.actor(req)));
  };

  adjustStock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireProduct(req);
    const body = validatedBody<AdjustStockBody>(req);
    sendSuccess(
      res,
      await this.products.adjustStock(
        org.id,
        product.id,
        body.delta,
        body.reason ?? null,
        this.actor(req),
      ),
    );
  };

  requestImageUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireProduct(req);
    const body = validatedBody<ProductImageUploadUrlBody>(req);
    sendSuccess(res, await this.products.requestImageUploadUrl(org.id, product.id, body));
  };

  addImage = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireProduct(req);
    const body = validatedBody<FinalizeProductImageBody>(req);
    sendSuccess(res, await this.products.addImage(org.id, product.id, this.actor(req), body));
  };

  removeImage = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireProduct(req);
    const { imageId } = validatedParams<{ imageId: string }>(req);
    sendSuccess(res, await this.products.removeImage(org.id, product.id, imageId, this.actor(req)));
  };
}
