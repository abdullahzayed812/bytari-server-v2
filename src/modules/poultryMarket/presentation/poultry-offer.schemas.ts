import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { phoneSchema } from '../../../shared/validation/common.js';
import { BIRD_TYPES, MAX_POULTRY_OFFER_IMAGES, PRICING_METHODS } from '../domain/poultry-offer.constants.js';

/** Money as a string — never parsed to a float. `numeric(12,2)`, non-negative. */
const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Expected a non-negative amount like "3000" or "3000.50"');
const weightSchema = z
  .string()
  .trim()
  .regex(/^\d{1,4}(\.\d{1,2})?$/, 'Expected a non-negative weight like "3.00"');

const hasControlChar = (v: string): boolean => {
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};
const filename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((v) => !v.includes('/') && !v.includes('\\') && !hasControlChar(v), {
    message: 'filename must not contain path separators or control characters',
  });

export const poultryOfferUploadUrlBodySchema = z
  .object({
    filename,
    mimeType: z.string().trim().min(1).max(255),
    size: z.number().int().positive().max(5 * 1024 * 1024),
  })
  .strict();
export type PoultryOfferUploadUrlBody = z.infer<typeof poultryOfferUploadUrlBodySchema>;

export const createPoultryOfferBodySchema = z.object({
  birdType: z.enum(BIRD_TYPES).default('BROILER'),
  breed: z.string().trim().max(160).optional(),
  quantity: z.coerce.number().int().min(1).max(100_000_000),
  pricingMethod: z.enum(PRICING_METHODS).default('PER_KG'),
  price: moneySchema,
  ageWeeks: z.coerce.number().int().min(0).max(500).optional(),
  weightKg: weightSchema.optional(),
  governorate: z.string().trim().min(1).max(120),
  district: z.string().trim().max(120).optional(),
  phone: phoneSchema,
  whatsapp: phoneSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  galleryKeys: z.array(z.string().trim().min(1).max(1024)).max(MAX_POULTRY_OFFER_IMAGES).default([]),
});
export type CreatePoultryOfferBody = z.infer<typeof createPoultryOfferBodySchema>;

export const listPoultryOffersQuerySchema = paginationQuerySchema.extend({
  birdType: z.enum(BIRD_TYPES).optional(),
  governorate: z.string().trim().min(1).max(120).optional(),
});
export type ListPoultryOffersQuery = z.infer<typeof listPoultryOffersQuerySchema>;

export const listAdminPoultryOffersQuerySchema = listPoultryOffersQuerySchema.extend({
  status: z.enum(['ACTIVE', 'REMOVED']).optional(),
});
export type ListAdminPoultryOffersQuery = z.infer<typeof listAdminPoultryOffersQuerySchema>;

export const poultryOfferParamSchema = z.object({ offerId: z.string().uuid() });
