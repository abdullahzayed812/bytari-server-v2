import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { PetStoreAdminService } from '../application/pet-owner-store-admin.service.js';
import type {
  PetStoreOrderService,
  PetStoreActor,
} from '../application/pet-owner-store-order.service.js';
import type {
  AdminListOrdersQuery,
  AdminListProductsQuery,
  CreateCategoryBody,
  CreateProductBody,
  ImageUploadUrlBody,
  RegisterImageBody,
  UpdateCategoryBody,
  UpdateOrderStatusBody,
  UpdateProductBody,
} from './pet-owner-store.schemas.js';

/** Admin / supervisor HTTP adapter for Pet Owners Store management. */
export class PetStoreAdminController {
  constructor(
    private readonly admin: PetStoreAdminService,
    private readonly orders: PetStoreOrderService,
  ) {}

  private actor(req: Request): PetStoreActor {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- products ---------------------------------------------

  listProducts = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<AdminListProductsQuery>(req);
    const { items, total } = await this.admin.listProducts({
      page: q.page,
      pageSize: q.pageSize,
      categoryId: q.categoryId,
      search: q.search,
      sort: q.sort,
      order: q.order,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getProduct = async (req: Request, res: Response): Promise<void> => {
    const { productId } = validatedParams<{ productId: string }>(req);
    sendSuccess(res, await this.admin.getProduct(productId));
  };

  createProduct = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateProductBody>(req);
    sendSuccess(res, await this.admin.createProduct(this.actor(req), body), StatusCodes.CREATED);
  };

  updateProduct = async (req: Request, res: Response): Promise<void> => {
    const { productId } = validatedParams<{ productId: string }>(req);
    const body = validatedBody<UpdateProductBody>(req);
    sendSuccess(res, await this.admin.updateProduct(this.actor(req), productId, body));
  };

  deactivateProduct = async (req: Request, res: Response): Promise<void> => {
    const { productId } = validatedParams<{ productId: string }>(req);
    sendSuccess(res, await this.admin.deactivateProduct(this.actor(req), productId));
  };

  requestProductImageUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { productId } = validatedParams<{ productId: string }>(req);
    const body = validatedBody<ImageUploadUrlBody>(req);
    sendSuccess(res, await this.admin.requestProductImageUploadUrl(productId, body));
  };

  registerProductImage = async (req: Request, res: Response): Promise<void> => {
    const { productId } = validatedParams<{ productId: string }>(req);
    const body = validatedBody<RegisterImageBody>(req);
    sendSuccess(
      res,
      await this.admin.registerProductImage(this.actor(req), productId, body),
      StatusCodes.CREATED,
    );
  };

  removeProductImage = async (req: Request, res: Response): Promise<void> => {
    const { productId, imageId } = validatedParams<{ productId: string; imageId: string }>(req);
    sendSuccess(res, await this.admin.removeProductImage(this.actor(req), productId, imageId));
  };

  // --- categories -----------------------------------------

  listCategories = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.admin.listCategories());
  };

  createCategory = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateCategoryBody>(req);
    sendSuccess(res, await this.admin.createCategory(this.actor(req), body), StatusCodes.CREATED);
  };

  updateCategory = async (req: Request, res: Response): Promise<void> => {
    const { categoryId } = validatedParams<{ categoryId: string }>(req);
    const body = validatedBody<UpdateCategoryBody>(req);
    sendSuccess(res, await this.admin.updateCategory(this.actor(req), categoryId, body));
  };

  deleteCategory = async (req: Request, res: Response): Promise<void> => {
    const { categoryId } = validatedParams<{ categoryId: string }>(req);
    await this.admin.deleteCategory(this.actor(req), categoryId);
    res.status(StatusCodes.NO_CONTENT).send();
  };

  requestCategoryImageUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { categoryId } = validatedParams<{ categoryId: string }>(req);
    const body = validatedBody<ImageUploadUrlBody>(req);
    sendSuccess(res, await this.admin.requestCategoryImageUploadUrl(categoryId, body));
  };

  registerCategoryImage = async (req: Request, res: Response): Promise<void> => {
    const { categoryId } = validatedParams<{ categoryId: string }>(req);
    const body = validatedBody<RegisterImageBody>(req);
    sendSuccess(res, await this.admin.registerCategoryImage(this.actor(req), categoryId, body));
  };

  // --- orders --------------------------------------------

  listOrders = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<AdminListOrdersQuery>(req);
    const { items, total } = await this.orders.listAllOrders({
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      userId: q.userId,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOrder = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = validatedParams<{ orderId: string }>(req);
    sendSuccess(res, await this.orders.getOrderForAdmin(orderId));
  };

  updateOrderStatus = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = validatedParams<{ orderId: string }>(req);
    const body = validatedBody<UpdateOrderStatusBody>(req);
    sendSuccess(res, await this.orders.setOrderStatus(this.actor(req), orderId, body.status));
  };
}
