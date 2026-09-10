import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  VETERINARY_STORE_PRODUCT_STATUSES,
  VETERINARY_STORE_PRODUCT_TYPES,
} from '../domain/veterinary-store-product.constants.js';

const nameSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().min(1).max(4000);
/** Money as a string — never parsed to a float. `numeric(12,2)`, non-negative. */
const priceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Expected a non-negative amount like "12.50"');
const stockSchema = z.coerce.number().int().min(0).max(100_000_000);

/** Short free-text detail fields shown on the product-details screen. */
const detailFieldSchema = z.string().trim().min(1).max(300);
const highlightsSchema = z.array(z.string().trim().min(1).max(60)).max(6);

const detailFieldsShape = {
  subtype: detailFieldSchema.nullable().optional(),
  weight: detailFieldSchema.nullable().optional(),
  usageInstructions: detailFieldSchema.nullable().optional(),
  dosage: detailFieldSchema.nullable().optional(),
  shelfLife: detailFieldSchema.nullable().optional(),
  manufacturer: detailFieldSchema.nullable().optional(),
  highlights: highlightsSchema.optional(),
};

// --- create / update ------------------------------------------

export const createVeterinaryStoreProductBodySchema = z.object({
  name: nameSchema,
  description: descriptionSchema.nullable().optional(),
  productType: z.enum(VETERINARY_STORE_PRODUCT_TYPES),
  price: priceSchema.nullable().optional(),
  stockQuantity: stockSchema.optional(),
  ...detailFieldsShape,
});
export type CreateVeterinaryStoreProductBody = z.infer<typeof createVeterinaryStoreProductBodySchema>;

export const updateVeterinaryStoreProductBodySchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    productType: z.enum(VETERINARY_STORE_PRODUCT_TYPES).optional(),
    price: priceSchema.nullable().optional(),
    status: z.enum(VETERINARY_STORE_PRODUCT_STATUSES).optional(),
    ...detailFieldsShape,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateVeterinaryStoreProductBody = z.infer<typeof updateVeterinaryStoreProductBodySchema>;

// --- images -------------------------------------------------------

export const veterinaryStoreProductImageUploadUrlBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
  size: z.number().int().positive(),
});
export type VeterinaryStoreProductImageUploadUrlBody = z.infer<
  typeof veterinaryStoreProductImageUploadUrlBodySchema
>;

export const finalizeVeterinaryStoreProductImageBodySchema = z.object({
  storageKey: z.string().trim().min(1).max(1000),
  mimeType: z.string().trim().min(1).max(100),
});
export type FinalizeVeterinaryStoreProductImageBody = z.infer<
  typeof finalizeVeterinaryStoreProductImageBodySchema
>;

export const veterinaryStoreProductImageParamSchema = z.object({
  organizationId: z.string().uuid(),
  productId: z.string().uuid(),
  imageId: z.string().uuid(),
});

// --- inventory --------------------------------------------

export const adjustVeterinaryStoreStockBodySchema = z.object({
  delta: z.coerce
    .number()
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((v) => v !== 0, { message: 'delta must be non-zero' }),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type AdjustVeterinaryStoreStockBody = z.infer<typeof adjustVeterinaryStoreStockBodySchema>;

// --- params -------------------------------------------------

export const veterinaryStoreIdParamSchema = z.object({ organizationId: z.string().uuid() });
export const veterinaryStoreProductParamSchema = z.object({
  organizationId: z.string().uuid(),
  productId: z.string().uuid(),
});

// --- list query ------------------------------------------

export const listVeterinaryStoreProductsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VETERINARY_STORE_PRODUCT_STATUSES).optional(),
  type: z.enum(VETERINARY_STORE_PRODUCT_TYPES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(['name', 'price', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type ListVeterinaryStoreProductsQuery = z.infer<typeof listVeterinaryStoreProductsQuerySchema>;

/** Public catalog browse (`GET /organizations/discover/:organizationId/products`) — no `status`, always ACTIVE. */
export const publicListVeterinaryStoreProductsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(VETERINARY_STORE_PRODUCT_TYPES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(['name', 'price', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type PublicListVeterinaryStoreProductsQuery = z.infer<
  typeof publicListVeterinaryStoreProductsQuerySchema
>;

export const publicVeterinaryStoreProductParamSchema = z.object({
  organizationId: z.string().uuid(),
  productId: z.string().uuid(),
});
