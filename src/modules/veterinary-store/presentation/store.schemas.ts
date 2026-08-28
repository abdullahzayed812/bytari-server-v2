import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { PRODUCT_STATUSES, PRODUCT_TYPES } from '../domain/store.constants.js';

const nameSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().min(1).max(4000);
/** Money as a string — never parsed to a float. `numeric(12,2)`, non-negative. */
const priceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Expected a non-negative amount like "12.50"');
const stockSchema = z.coerce.number().int().min(0).max(100_000_000);

// --- create / update ------------------------------------------

export const createProductBodySchema = z.object({
  name: nameSchema,
  description: descriptionSchema.nullable().optional(),
  productType: z.enum(PRODUCT_TYPES),
  price: priceSchema.nullable().optional(),
  stockQuantity: stockSchema.optional(),
});
export type CreateProductBody = z.infer<typeof createProductBodySchema>;

export const updateProductBodySchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    productType: z.enum(PRODUCT_TYPES).optional(),
    price: priceSchema.nullable().optional(),
    status: z.enum(PRODUCT_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

// --- inventory --------------------------------------------

export const adjustStockBodySchema = z.object({
  delta: z.coerce
    .number()
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((v) => v !== 0, { message: 'delta must be non-zero' }),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type AdjustStockBody = z.infer<typeof adjustStockBodySchema>;

// --- params -------------------------------------------------

export const storeIdParamSchema = z.object({ organizationId: z.string().uuid() });
export const productParamSchema = z.object({
  organizationId: z.string().uuid(),
  productId: z.string().uuid(),
});

// --- list query ------------------------------------------

export const listProductsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PRODUCT_STATUSES).optional(),
  type: z.enum(PRODUCT_TYPES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(['name', 'price', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
