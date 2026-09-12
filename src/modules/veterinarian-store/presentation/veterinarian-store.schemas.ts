import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  VETERINARIAN_STORE_ALLOWED_IMAGE_MIME,
  VETERINARIAN_STORE_CATEGORY_STATUSES,
  VETERINARIAN_STORE_MAX_IMAGE_BYTES,
  VETERINARIAN_STORE_MAX_ITEM_QUANTITY,
  VETERINARIAN_STORE_ORDER_STATUSES,
  VETERINARIAN_STORE_PAYMENT_METHODS,
  VETERINARIAN_STORE_PRODUCT_SORTS,
  VETERINARIAN_STORE_PRODUCT_STATUSES,
} from '../domain/veterinarian-store.constants.js';

const nameSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().min(1).max(4000);
const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,63}$/, 'Expected a slug like "pet-food"');
/** Money as a string — never parsed to a float. `numeric(12,2)`, non-negative. */
const priceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Expected a non-negative amount like "12.50"');
const stockSchema = z.coerce.number().int().min(0).max(1_000_000);
const quantitySchema = z.coerce.number().int().min(1).max(VETERINARIAN_STORE_MAX_ITEM_QUANTITY);
const attributesSchema = z.record(
  z.string().trim().min(1).max(60),
  z.string().trim().min(1).max(200),
);
const phoneSchema = z.string().trim().min(5).max(30);

// --- params -------------------------------------------------------

export const productIdParamSchema = z.object({ productId: z.string().uuid() });
export const categoryIdParamSchema = z.object({ categoryId: z.string().uuid() });
export const orderIdParamSchema = z.object({ orderId: z.string().uuid() });
export const cartItemIdParamSchema = z.object({ itemId: z.string().uuid() });
export const productImageParamSchema = z.object({
  productId: z.string().uuid(),
  imageId: z.string().uuid(),
});

// --- consumer: catalogue ---------------------------------------

export const listProductsQuerySchema = paginationQuerySchema.extend({
  categoryId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(VETERINARIAN_STORE_PRODUCT_SORTS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const listCategoriesQuerySchema = z.object({
  homeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

// --- consumer: cart -----------------------------------------

export const addCartItemBodySchema = z.object({
  productId: z.string().uuid(),
  quantity: quantitySchema.default(1),
});
export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;

export const updateCartItemBodySchema = z.object({ quantity: quantitySchema });
export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;

// --- consumer: checkout ------------------------------------

export const checkoutBodySchema = z.object({
  paymentMethod: z.enum(VETERINARIAN_STORE_PAYMENT_METHODS),
  recipientName: nameSchema,
  recipientPhone: phoneSchema,
  city: z.string().trim().min(1).max(120),
  addressLine: z.string().trim().min(1).max(500),
  note: z.string().trim().min(1).max(500).nullable().optional(),
});
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VETERINARIAN_STORE_ORDER_STATUSES).optional(),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// --- admin: products -------------------------------------

export const adminListProductsQuerySchema = listProductsQuerySchema.extend({
  status: z.enum(VETERINARIAN_STORE_PRODUCT_STATUSES).optional(),
});
export type AdminListProductsQuery = z.infer<typeof adminListProductsQuerySchema>;

export const createProductBodySchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  name: nameSchema,
  description: descriptionSchema.nullable().optional(),
  price: priceSchema,
  stockQuantity: stockSchema.optional(),
  attributes: attributesSchema.nullable().optional(),
  status: z.enum(VETERINARIAN_STORE_PRODUCT_STATUSES).optional(),
});
export type CreateProductBody = z.infer<typeof createProductBodySchema>;

export const updateProductBodySchema = z
  .object({
    categoryId: z.string().uuid().nullable().optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    price: priceSchema.optional(),
    stockQuantity: stockSchema.optional(),
    attributes: attributesSchema.nullable().optional(),
    status: z.enum(VETERINARIAN_STORE_PRODUCT_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

// --- admin: categories ---------------------------------

export const createCategoryBodySchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  showOnHome: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  status: z.enum(VETERINARIAN_STORE_CATEGORY_STATUSES).optional(),
});
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

export const updateCategoryBodySchema = z
  .object({
    slug: slugSchema.optional(),
    name: nameSchema.optional(),
    showOnHome: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
    status: z.enum(VETERINARIAN_STORE_CATEGORY_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

// --- admin: images ------------------------------------

export const imageUploadUrlBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(VETERINARIAN_STORE_ALLOWED_IMAGE_MIME),
  size: z.coerce.number().int().positive().max(VETERINARIAN_STORE_MAX_IMAGE_BYTES),
});
export type ImageUploadUrlBody = z.infer<typeof imageUploadUrlBodySchema>;

export const registerImageBodySchema = z.object({
  storageKey: z.string().trim().min(1).max(1024),
  mimeType: z.enum(VETERINARIAN_STORE_ALLOWED_IMAGE_MIME),
});
export type RegisterImageBody = z.infer<typeof registerImageBodySchema>;

// --- admin: orders -----------------------------------

export const adminListOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VETERINARIAN_STORE_ORDER_STATUSES).optional(),
  userId: z.string().uuid().optional(),
});
export type AdminListOrdersQuery = z.infer<typeof adminListOrdersQuerySchema>;

export const updateOrderStatusBodySchema = z.object({
  status: z.enum(VETERINARIAN_STORE_ORDER_STATUSES),
});
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusBodySchema>;
