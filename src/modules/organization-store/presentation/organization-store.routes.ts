import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { createOrganizationSubscriptionGuard } from '../../organizations/presentation/organization-subscription.middleware.js';
import { withStoreOrganization } from '../../veterinary-office/presentation/veterinary-office-product.middleware.js';
import {
  STORE_ORDER_MANAGE_PERMISSION,
  STORE_ORDER_READ_PERMISSION,
} from '../domain/organization-store.constants.js';
import {
  OrganizationStoreController,
  OrganizationStoreSellerController,
} from './organization-store.controller.js';
import {
  addCartItemBodySchema,
  cancelOrderBodySchema,
  cartItemParamSchema,
  checkoutBodySchema,
  listMyOrdersQuerySchema,
  orderIdParamSchema,
  sellerListOrdersQuerySchema,
  storeOrderParamSchema,
  storeOrganizationParamSchema,
  updateCartItemBodySchema,
  updateOrderStatusBodySchema,
} from './organization-store.schemas.js';

/**
 * Customer side of the Clinic / Veterinary Office stores, mounted at
 * `/organization-store`. `authenticate` only — any signed-in user can keep a
 * cart per store, check out and track their own orders. Ownership is enforced
 * in the services (`WHERE user_id = ?`): another shopper's cart / order reads
 * as 404.
 */
export function createOrganizationStoreRouter(c: Container): Router {
  const ctrl = new OrganizationStoreController(
    c.organizationStoreCartService,
    c.organizationStoreOrderService,
    c.chatService,
  );
  const r = Router();
  r.use(c.authenticate);

  r.get('/carts', asyncHandler(ctrl.listMyCarts));
  r.get(
    '/organizations/:organizationId/cart',
    validate({ params: storeOrganizationParamSchema }),
    asyncHandler(ctrl.getCart),
  );
  r.delete(
    '/organizations/:organizationId/cart',
    validate({ params: storeOrganizationParamSchema }),
    asyncHandler(ctrl.clearCart),
  );
  r.post(
    '/organizations/:organizationId/cart/items',
    validate({ params: storeOrganizationParamSchema, body: addCartItemBodySchema }),
    asyncHandler(ctrl.addCartItem),
  );
  r.patch(
    '/organizations/:organizationId/cart/items/:itemId',
    validate({ params: cartItemParamSchema, body: updateCartItemBodySchema }),
    asyncHandler(ctrl.updateCartItem),
  );
  r.delete(
    '/organizations/:organizationId/cart/items/:itemId',
    validate({ params: cartItemParamSchema }),
    asyncHandler(ctrl.removeCartItem),
  );
  r.post(
    '/organizations/:organizationId/orders',
    validate({ params: storeOrganizationParamSchema, body: checkoutBodySchema }),
    asyncHandler(ctrl.checkout),
  );

  r.get('/orders', validate({ query: listMyOrdersQuerySchema }), asyncHandler(ctrl.listMyOrders));
  r.get(
    '/orders/:orderId',
    validate({ params: orderIdParamSchema }),
    asyncHandler(ctrl.getMyOrder),
  );
  // "مراسلة المتجر" from the order page — only for an order the caller placed.
  r.post(
    '/orders/:orderId/conversation',
    validate({ params: orderIdParamSchema }),
    asyncHandler(ctrl.openOrderConversation),
  );
  r.post(
    '/orders/:orderId/cancel',
    validate({ params: orderIdParamSchema, body: cancelOrderBodySchema }),
    asyncHandler(ctrl.cancelMyOrder),
  );
  return r;
}

/**
 * Seller side — a clinic's / office's incoming orders, mounted at
 * `/organizations` beside the product routes:
 *
 *   authenticate → validate → withOrganization → withStoreOrganization
 *                → authorizeOrg(store.order.read|manage) → subscription guard
 *
 * The OWNER (override), ADMIN, or a member holding the key in THIS
 * organization (e.g. a store supervisor) passes. An expired clinic / office
 * cannot work its orders until renewed, like its products.
 */
export function createOrganizationStoreSellerRouter(c: Container): Router {
  const ctrl = new OrganizationStoreSellerController(
    c.organizationStoreOrderService,
    c.chatService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const activeSubscription = createOrganizationSubscriptionGuard({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });
  const read = authorizeOrg(STORE_ORDER_READ_PERMISSION);
  const manage = authorizeOrg(STORE_ORDER_MANAGE_PERMISSION);

  const r = Router();
  r.use(c.authenticate);
  const base = '/:organizationId/store-orders';

  r.get(
    base,
    validate({ params: storeOrganizationParamSchema, query: sellerListOrdersQuerySchema }),
    withOrganization,
    withStoreOrganization,
    read,
    activeSubscription,
    asyncHandler(ctrl.list),
  );
  r.get(
    `${base}/summary`,
    validate({ params: storeOrganizationParamSchema }),
    withOrganization,
    withStoreOrganization,
    read,
    activeSubscription,
    asyncHandler(ctrl.summary),
  );
  r.get(
    `${base}/:orderId`,
    validate({ params: storeOrderParamSchema }),
    withOrganization,
    withStoreOrganization,
    read,
    activeSubscription,
    asyncHandler(ctrl.getOne),
  );
  // "مراسلة الزبون" — anyone who may read this store's orders may message the
  // customer of one of THEM (never an arbitrary user through this route).
  r.post(
    `${base}/:orderId/conversation`,
    validate({ params: storeOrderParamSchema }),
    withOrganization,
    withStoreOrganization,
    read,
    activeSubscription,
    asyncHandler(ctrl.openOrderConversation),
  );
  r.patch(
    `${base}/:orderId/status`,
    validate({ params: storeOrderParamSchema, body: updateOrderStatusBodySchema }),
    withOrganization,
    withStoreOrganization,
    manage,
    activeSubscription,
    asyncHandler(ctrl.updateStatus),
  );
  return r;
}
