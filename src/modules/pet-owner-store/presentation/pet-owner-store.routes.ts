import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { PetStoreController } from './pet-owner-store.controller.js';
import { PetStoreAdminController } from './pet-owner-store-admin.controller.js';
import {
  addCartItemBodySchema,
  adminListOrdersQuerySchema,
  adminListProductsQuerySchema,
  cartItemIdParamSchema,
  categoryIdParamSchema,
  checkoutBodySchema,
  createCategoryBodySchema,
  createProductBodySchema,
  imageUploadUrlBodySchema,
  listCategoriesQuerySchema,
  listOrdersQuerySchema,
  listProductsQuerySchema,
  orderIdParamSchema,
  productIdParamSchema,
  productImageParamSchema,
  registerImageBodySchema,
  updateCartItemBodySchema,
  updateCategoryBodySchema,
  updateOrderStatusBodySchema,
  updateProductBodySchema,
} from './pet-owner-store.schemas.js';

/**
 * Consumer Pet Owners Store, mounted at `/pet-owner-store`. Every route is
 * `authenticate → validate → controller` — any signed-in user can browse, keep
 * a cart and place / view their own orders. Cart-item and order ownership is
 * enforced in the services (`WHERE user_id = ?`), so a caller can never reach
 * another shopper's data.
 */
export function createPetOwnerStoreRouter(c: Container): Router {
  const ctrl = new PetStoreController(
    c.petStoreCatalogService,
    c.petStoreCartService,
    c.petStoreOrderService,
  );

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/categories',
    validate({ query: listCategoriesQuerySchema }),
    asyncHandler(ctrl.listCategories),
  );
  r.get('/products', validate({ query: listProductsQuerySchema }), asyncHandler(ctrl.listProducts));
  r.get(
    '/products/:productId',
    validate({ params: productIdParamSchema }),
    asyncHandler(ctrl.getProduct),
  );

  r.get('/cart', asyncHandler(ctrl.getCart));
  r.post('/cart/items', validate({ body: addCartItemBodySchema }), asyncHandler(ctrl.addCartItem));
  r.patch(
    '/cart/items/:itemId',
    validate({ params: cartItemIdParamSchema, body: updateCartItemBodySchema }),
    asyncHandler(ctrl.updateCartItem),
  );
  r.delete(
    '/cart/items/:itemId',
    validate({ params: cartItemIdParamSchema }),
    asyncHandler(ctrl.removeCartItem),
  );
  r.delete('/cart', asyncHandler(ctrl.clearCart));

  r.post('/orders', validate({ body: checkoutBodySchema }), asyncHandler(ctrl.checkout));
  r.get('/orders', validate({ query: listOrdersQuerySchema }), asyncHandler(ctrl.listMyOrders));
  r.get(
    '/orders/:orderId',
    validate({ params: orderIdParamSchema }),
    asyncHandler(ctrl.getMyOrder),
  );

  return r;
}

/**
 * Admin / supervisor management, mounted at `/admin/pet-owner-store`. Guarded by
 * `authorize('pet_store.<area>.manage')` — the ADMIN override or an ACTIVE
 * `PET_OWNER_STORE` system-supervisor assignment satisfies it. The permission
 * check is server-side, never UI-only.
 */
export function createAdminPetOwnerStoreRouter(c: Container): Router {
  const ctrl = new PetStoreAdminController(c.petStoreAdminService, c.petStoreOrderService);
  const { authorize } = c.authorization;
  const manageProducts = authorize('pet_store.product.manage');
  const manageCategories = authorize('pet_store.category.manage');
  const manageOrders = authorize('pet_store.order.manage');

  const r = Router();
  r.use(c.authenticate);

  // --- products ---
  r.get(
    '/products',
    manageProducts,
    validate({ query: adminListProductsQuerySchema }),
    asyncHandler(ctrl.listProducts),
  );
  r.post(
    '/products',
    manageProducts,
    validate({ body: createProductBodySchema }),
    asyncHandler(ctrl.createProduct),
  );
  r.get(
    '/products/:productId',
    manageProducts,
    validate({ params: productIdParamSchema }),
    asyncHandler(ctrl.getProduct),
  );
  r.patch(
    '/products/:productId',
    manageProducts,
    validate({ params: productIdParamSchema, body: updateProductBodySchema }),
    asyncHandler(ctrl.updateProduct),
  );
  r.delete(
    '/products/:productId',
    manageProducts,
    validate({ params: productIdParamSchema }),
    asyncHandler(ctrl.deactivateProduct),
  );
  r.post(
    '/products/:productId/image/upload-url',
    manageProducts,
    validate({ params: productIdParamSchema, body: imageUploadUrlBodySchema }),
    asyncHandler(ctrl.requestProductImageUploadUrl),
  );
  r.post(
    '/products/:productId/images',
    manageProducts,
    validate({ params: productIdParamSchema, body: registerImageBodySchema }),
    asyncHandler(ctrl.registerProductImage),
  );
  r.delete(
    '/products/:productId/images/:imageId',
    manageProducts,
    validate({ params: productImageParamSchema }),
    asyncHandler(ctrl.removeProductImage),
  );

  // --- categories ---
  r.get('/categories', manageCategories, asyncHandler(ctrl.listCategories));
  r.post(
    '/categories',
    manageCategories,
    validate({ body: createCategoryBodySchema }),
    asyncHandler(ctrl.createCategory),
  );
  r.patch(
    '/categories/:categoryId',
    manageCategories,
    validate({ params: categoryIdParamSchema, body: updateCategoryBodySchema }),
    asyncHandler(ctrl.updateCategory),
  );
  r.delete(
    '/categories/:categoryId',
    manageCategories,
    validate({ params: categoryIdParamSchema }),
    asyncHandler(ctrl.deleteCategory),
  );
  r.post(
    '/categories/:categoryId/image/upload-url',
    manageCategories,
    validate({ params: categoryIdParamSchema, body: imageUploadUrlBodySchema }),
    asyncHandler(ctrl.requestCategoryImageUploadUrl),
  );
  r.post(
    '/categories/:categoryId/image',
    manageCategories,
    validate({ params: categoryIdParamSchema, body: registerImageBodySchema }),
    asyncHandler(ctrl.registerCategoryImage),
  );

  // --- orders ---
  r.get(
    '/orders',
    manageOrders,
    validate({ query: adminListOrdersQuerySchema }),
    asyncHandler(ctrl.listOrders),
  );
  r.get(
    '/orders/:orderId',
    manageOrders,
    validate({ params: orderIdParamSchema }),
    asyncHandler(ctrl.getOrder),
  );
  r.patch(
    '/orders/:orderId/status',
    manageOrders,
    validate({ params: orderIdParamSchema, body: updateOrderStatusBodySchema }),
    asyncHandler(ctrl.updateOrderStatus),
  );

  return r;
}
