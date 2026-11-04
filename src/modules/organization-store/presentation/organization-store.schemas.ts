import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  ORGANIZATION_STORE_MAX_ITEM_QUANTITY,
  ORGANIZATION_STORE_ORDER_STATUSES,
  ORGANIZATION_STORE_PAYMENT_METHODS,
  STORE_ORGANIZATION_TYPES,
} from '../domain/organization-store.constants.js';

const quantitySchema = z.coerce.number().int().min(1).max(ORGANIZATION_STORE_MAX_ITEM_QUANTITY);
const noteSchema = z.string().trim().min(1).max(500).nullable().optional();
const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

// --- params -------------------------------------------------------

export const storeOrganizationParamSchema = z.object({ organizationId: z.string().uuid() });
export const cartItemParamSchema = z.object({
  organizationId: z.string().uuid(),
  itemId: z.string().uuid(),
});
export const orderIdParamSchema = z.object({ orderId: z.string().uuid() });
export const storeOrderParamSchema = z.object({
  organizationId: z.string().uuid(),
  orderId: z.string().uuid(),
});

// --- customer -----------------------------------------------------

export const addCartItemBodySchema = z.object({
  productId: z.string().uuid(),
  quantity: quantitySchema.default(1),
});
export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;

export const updateCartItemBodySchema = z.object({ quantity: quantitySchema });
export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;

export const checkoutBodySchema = z.object({
  paymentMethod: z.enum(ORGANIZATION_STORE_PAYMENT_METHODS).default('COD'),
  recipientName: z.string().trim().min(1).max(200),
  recipientPhone: z.string().trim().min(5).max(30),
  city: z.string().trim().min(1).max(120),
  addressLine: z.string().trim().min(1).max(500),
  note: noteSchema,
});
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

export const listMyOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ORGANIZATION_STORE_ORDER_STATUSES).optional(),
  organizationId: z.string().uuid().optional(),
  organizationType: z.enum(STORE_ORGANIZATION_TYPES).optional(),
});
export type ListMyOrdersQuery = z.infer<typeof listMyOrdersQuerySchema>;

export const cancelOrderBodySchema = z.object({ note: noteSchema });
export type CancelOrderBody = z.infer<typeof cancelOrderBodySchema>;

// --- seller -------------------------------------------------------

export const sellerListOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ORGANIZATION_STORE_ORDER_STATUSES).optional(),
  newOnly: booleanQuery,
  search: z.string().trim().min(1).max(160).optional(),
});
export type SellerListOrdersQuery = z.infer<typeof sellerListOrdersQuerySchema>;

export const updateOrderStatusBodySchema = z.object({
  status: z.enum(ORGANIZATION_STORE_ORDER_STATUSES),
  note: noteSchema,
});
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusBodySchema>;

/** `PATCH /organizations/:id/store-orders/settings` — the "receive new orders" switch. */
export const orderSettingsBodySchema = z.object({ ordersEnabled: z.boolean() }).strict();
export type OrderSettingsBody = z.infer<typeof orderSettingsBodySchema>;
