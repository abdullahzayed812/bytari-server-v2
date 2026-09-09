import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { PetStoreCatalogService } from '../application/pet-owner-store-catalog.service.js';
import type { PetStoreCartService } from '../application/pet-owner-store-cart.service.js';
import type {
  PetStoreOrderService,
  PetStoreActor,
} from '../application/pet-owner-store-order.service.js';
import type {
  AddCartItemBody,
  CheckoutBody,
  ListCategoriesQuery,
  ListOrdersQuery,
  ListProductsQuery,
  UpdateCartItemBody,
} from './pet-owner-store.schemas.js';

/** Consumer HTTP adapter for the Pet Owners Store. No business logic. */
export class PetStoreController {
  constructor(
    private readonly catalog: PetStoreCatalogService,
    private readonly carts: PetStoreCartService,
    private readonly orders: PetStoreOrderService,
  ) {}

  private actor(req: Request): PetStoreActor {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- catalogue -----------------------------------------------

  listCategories = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListCategoriesQuery>(req);
    sendSuccess(res, await this.catalog.listCategories({ homeOnly: q.homeOnly }));
  };

  listProducts = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListProductsQuery>(req);
    const { items, total } = await this.catalog.listProducts({
      page: q.page,
      pageSize: q.pageSize,
      categoryId: q.categoryId,
      search: q.search,
      sort: q.sort,
      order: q.order,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getProduct = async (req: Request, res: Response): Promise<void> => {
    const { productId } = validatedParams<{ productId: string }>(req);
    sendSuccess(res, await this.catalog.getProduct(productId));
  };

  // --- cart ---------------------------------------------------

  getCart = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.carts.getCart(requireAuth(req).userId));
  };

  addCartItem = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<AddCartItemBody>(req);
    sendSuccess(
      res,
      await this.carts.addItem(requireAuth(req).userId, body.productId, body.quantity),
      StatusCodes.CREATED,
    );
  };

  updateCartItem = async (req: Request, res: Response): Promise<void> => {
    const { itemId } = validatedParams<{ itemId: string }>(req);
    const body = validatedBody<UpdateCartItemBody>(req);
    sendSuccess(res, await this.carts.updateItem(requireAuth(req).userId, itemId, body.quantity));
  };

  removeCartItem = async (req: Request, res: Response): Promise<void> => {
    const { itemId } = validatedParams<{ itemId: string }>(req);
    sendSuccess(res, await this.carts.removeItem(requireAuth(req).userId, itemId));
  };

  clearCart = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.carts.clearCart(requireAuth(req).userId));
  };

  // --- checkout / orders ------------------------------------

  checkout = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CheckoutBody>(req);
    const dto = await this.orders.checkout(this.actor(req), {
      paymentMethod: body.paymentMethod,
      recipientName: body.recipientName,
      recipientPhone: body.recipientPhone,
      city: body.city,
      addressLine: body.addressLine,
      note: body.note ?? null,
    });
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  listMyOrders = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListOrdersQuery>(req);
    const { items, total } = await this.orders.listMyOrders(requireAuth(req).userId, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getMyOrder = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = validatedParams<{ orderId: string }>(req);
    sendSuccess(res, await this.orders.getMyOrder(requireAuth(req).userId, orderId));
  };
}
