import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { VeterinaryOfficeProductService } from '../application/veterinary-office-product.service.js';
import { requireVeterinaryOfficeProduct } from './veterinary-office-product.middleware.js';
import type {
  AdjustVeterinaryOfficeStockBody,
  CreateVeterinaryOfficeProductBody,
  FinalizeVeterinaryOfficeProductImageBody,
  ListVeterinaryOfficeProductsQuery,
  VeterinaryOfficeProductImageUploadUrlBody,
  UpdateVeterinaryOfficeProductBody,
} from './veterinary-office-product.schemas.js';

/** Veterinary Office product HTTP adapter. No business logic. */
export class VeterinaryOfficeProductController {
  constructor(private readonly products: VeterinaryOfficeProductService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<CreateVeterinaryOfficeProductBody>(req);
    const dto = await this.products.create({ id: org.id, type: org.type }, body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListVeterinaryOfficeProductsQuery>(req);
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
    const product = requireVeterinaryOfficeProduct(req);
    sendSuccess(res, await this.products.get(org.id, product.id));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireVeterinaryOfficeProduct(req);
    const body = validatedBody<UpdateVeterinaryOfficeProductBody>(req);
    sendSuccess(res, await this.products.update(org.id, product.id, body, this.actor(req)));
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireVeterinaryOfficeProduct(req);
    sendSuccess(res, await this.products.deactivate(org.id, product.id, this.actor(req)));
  };

  adjustStock = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireVeterinaryOfficeProduct(req);
    const body = validatedBody<AdjustVeterinaryOfficeStockBody>(req);
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
    const product = requireVeterinaryOfficeProduct(req);
    const body = validatedBody<VeterinaryOfficeProductImageUploadUrlBody>(req);
    sendSuccess(res, await this.products.requestImageUploadUrl(org.id, product.id, body));
  };

  addImage = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireVeterinaryOfficeProduct(req);
    const body = validatedBody<FinalizeVeterinaryOfficeProductImageBody>(req);
    sendSuccess(res, await this.products.addImage(org.id, product.id, this.actor(req), body));
  };

  removeImage = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const product = requireVeterinaryOfficeProduct(req);
    const { imageId } = validatedParams<{ imageId: string }>(req);
    sendSuccess(res, await this.products.removeImage(org.id, product.id, imageId, this.actor(req)));
  };
}
