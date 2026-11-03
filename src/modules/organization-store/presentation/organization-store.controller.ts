import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { OrganizationStoreCartService } from '../application/organization-store-cart.service.js';
import type {
  OrganizationStoreActor,
  OrganizationStoreOrderService,
} from '../application/organization-store-order.service.js';
import type {
  AddCartItemBody,
  CancelOrderBody,
  CheckoutBody,
  ListMyOrdersQuery,
  SellerListOrdersQuery,
  UpdateCartItemBody,
  UpdateOrderStatusBody,
} from './organization-store.schemas.js';

function actorOf(req: Request): OrganizationStoreActor {
  return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
}

/** Customer HTTP adapter: carts, checkout, my orders. No business logic. */
export class OrganizationStoreController {
  constructor(
    private readonly carts: OrganizationStoreCartService,
    private readonly orders: OrganizationStoreOrderService,
  ) {}

  listMyCarts = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.carts.listMyCarts(requireAuth(req).userId));
  };

  getCart = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    sendSuccess(res, await this.carts.getCart(requireAuth(req).userId, organizationId));
  };

  addCartItem = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const body = validatedBody<AddCartItemBody>(req);
    sendSuccess(
      res,
      await this.carts.addItem(
        requireAuth(req).userId,
        organizationId,
        body.productId,
        body.quantity,
      ),
      StatusCodes.CREATED,
    );
  };

  updateCartItem = async (req: Request, res: Response): Promise<void> => {
    const { organizationId, itemId } = validatedParams<{ organizationId: string; itemId: string }>(
      req,
    );
    const body = validatedBody<UpdateCartItemBody>(req);
    sendSuccess(
      res,
      await this.carts.updateItem(requireAuth(req).userId, organizationId, itemId, body.quantity),
    );
  };

  removeCartItem = async (req: Request, res: Response): Promise<void> => {
    const { organizationId, itemId } = validatedParams<{ organizationId: string; itemId: string }>(
      req,
    );
    sendSuccess(res, await this.carts.removeItem(requireAuth(req).userId, organizationId, itemId));
  };

  clearCart = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    sendSuccess(res, await this.carts.clearCart(requireAuth(req).userId, organizationId));
  };

  checkout = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const body = validatedBody<CheckoutBody>(req);
    sendSuccess(
      res,
      await this.orders.checkout(actorOf(req), organizationId, body),
      StatusCodes.CREATED,
    );
  };

  listMyOrders = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListMyOrdersQuery>(req);
    const { items, total } = await this.orders.listMyOrders(requireAuth(req).userId, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      organizationId: q.organizationId,
      organizationType: q.organizationType,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getMyOrder = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = validatedParams<{ orderId: string }>(req);
    sendSuccess(res, await this.orders.getMyOrder(requireAuth(req).userId, orderId));
  };

  cancelMyOrder = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = validatedParams<{ orderId: string }>(req);
    const body = validatedBody<CancelOrderBody>(req);
    sendSuccess(res, await this.orders.cancelMyOrder(actorOf(req), orderId, body.note ?? null));
  };
}

/** Seller HTTP adapter: the organization's incoming orders. No business logic. */
export class OrganizationStoreSellerController {
  constructor(private readonly orders: OrganizationStoreOrderService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<SellerListOrdersQuery>(req);
    const { items, total } = await this.orders.listForOrganization(org.id, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      newOnly: q.newOnly,
      search: q.search,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  summary = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.orders.summaryForOrganization(requireOrganization(req).id));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = validatedParams<{ orderId: string }>(req);
    sendSuccess(res, await this.orders.getForSeller(requireOrganization(req).id, orderId));
  };

  updateStatus = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = validatedParams<{ orderId: string }>(req);
    const body = validatedBody<UpdateOrderStatusBody>(req);
    sendSuccess(
      res,
      await this.orders.setStatusAsSeller(
        actorOf(req),
        requireOrganization(req).id,
        orderId,
        body.status,
        body.note ?? null,
      ),
    );
  };
}
